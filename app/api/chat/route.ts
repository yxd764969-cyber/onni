import { NextRequest, NextResponse } from "next/server";

// 环境变量（在 Vercel 后台配置，不要硬编码）
const COZE_TOKEN = process.env.COZE_PAT!;
const BOT_ID = process.env.COZE_BOT_ID!;

// 敏感词列表（v0.1 最小集，可扩展）
const BANNED_KEYWORDS = ["朝鲜", "金正恩", "统一", "政党", "独岛", "竹岛", "慰安妇"];

export async function POST(req: NextRequest) {
  try {
    // 1. 解析请求体
    const { message, scenarioId, userId, conversationId } = await req.json();

    // 2. 参数校验
    if (!message || typeof message !== "string") {
      return NextResponse.json(
        { error: "message 不能为空" },
        { status: 400 }
      );
    }

    if (!userId || typeof userId !== "string") {
      return NextResponse.json(
        { error: "userId 不能为空" },
        { status: 400 }
      );
    }

    // 3. 敏感词过滤（前端先拦截，后端再做一道保险）
    if (BANNED_KEYWORDS.some((kw) => message.includes(kw))) {
      return NextResponse.json({
        onni_reply: "我是专注韩语学习的 Onni，这个话题我们换一下吧～你今天想练哪个场景？",
        correction_card: null,
        conversation_id: conversationId || null,
        is_restricted: true,
      });
    }

    // 4. 调用扣子 API 发起对话
    const payload: any = {
      bot_id: BOT_ID,
      user_id: userId,
      stream: false,
      additional_messages: [
        {
          role: "user",
          content: message,
          content_type: "text",
        },
      ],
      custom_variables: {
        current_scenario: scenarioId || "01", // 默认场景 01（第一次见面）
      },
    };

    // 如果有上一轮 conversation_id，追加到请求中维持上下文
    if (conversationId) {
      payload.conversation_id = conversationId;
    }

    const cozeResp = await fetch("https://api.coze.cn/v3/chat", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${COZE_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!cozeResp.ok) {
      const errorText = await cozeResp.text();
      console.error("扣子 API 请求失败:", errorText);
      return NextResponse.json(
        { error: "扣子服务暂时不可用" },
        { status: 502 }
      );
    }

    const cozeData = await cozeResp.json();

    // 检查扣子返回状态
    if (cozeData.code !== 0) {
      console.error("扣子 API 业务错误:", cozeData);
      return NextResponse.json(
        { error: cozeData.msg || "扣子服务异常" },
        { status: 500 }
      );
    }

    const newConversationId = cozeData.data.conversation_id;
    const chatId = cozeData.data.id;

    // 5. 轮询等待对话完成（v0.1 简单实现，v0.2 改流式）
    let status = "in_progress";
    let retries = 0;
    const maxRetries = 60; // 最多轮询 60 次（约 30 秒）

    while (status !== "completed" && retries < maxRetries) {
      await new Promise((r) => setTimeout(r, 500));
      retries++;

      const checkResp = await fetch(
        `https://api.coze.cn/v3/chat/retrieve?conversation_id=${newConversationId}&chat_id=${chatId}`,
        {
          headers: {
            Authorization: `Bearer ${COZE_TOKEN}`,
          },
        }
      );

      if (!checkResp.ok) {
        console.error("轮询状态失败:", await checkResp.text());
        break;
      }

      const checkData = await checkResp.json();
      status = checkData.data?.status || "failed";
    }

    if (status !== "completed") {
      console.warn("扣子对话未在超时前完成，状态:", status);
    }

    // 6. 获取对话消息列表
    const msgResp = await fetch(
      `https://api.coze.cn/v3/chat/message/list?chat_id=${chatId}&conversation_id=${newConversationId}`,
      {
        headers: {
          Authorization: `Bearer ${COZE_TOKEN}`,
        },
      }
    );

    if (!msgResp.ok) {
      console.error("获取消息失败:", await msgResp.text());
      return NextResponse.json(
        { error: "无法获取对话回复" },
        { status: 502 }
      );
    }

    const msgData = await msgResp.json();

    // 7. 解析返回消息
    const messages = msgData.data || [];
    const answerMsg = messages.find((m: any) => m.type === "answer");
    const followUpMsg = messages.find((m: any) => m.type === "follow_up");

    // 8. 构造返回给前端的数据
    const response: any = {
      onni_reply: answerMsg?.content || "Onni 暂时没有回复，请再试一次吧～",
      conversation_id: newConversationId,
      is_restricted: false,
    };

    // 如果存在纠错卡数据，原样返回（前端会解析 JSON）
    if (followUpMsg && followUpMsg.content) {
      try {
        // 尝试解析一下确认是合法 JSON，但原样返回给前端
        JSON.parse(followUpMsg.content);
        response.correction_card = followUpMsg.content;
      } catch {
        // 如果 parse 失败，说明不是 JSON 格式，就不作为纠错卡返回
        console.warn("纠错卡数据不是合法 JSON:", followUpMsg.content);
      }
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error("API 代理层未捕获异常:", error);
    return NextResponse.json(
      { error: "服务器内部错误" },
      { status: 500 }
    );
  }
}