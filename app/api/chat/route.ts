import { NextRequest } from "next/server";

// 环境变量（在 Vercel 后台配置，不要硬编码）
const COZE_TOKEN = process.env.COZE_PAT!;
const BOT_ID = process.env.COZE_BOT_ID!;

// 敏感词列表（v0.1 最小集，可扩展）
const BANNED_KEYWORDS = ["朝鲜", "金正恩", "统一", "政党", "独岛", "竹岛", "慰安妇"];

// 强制 Edge runtime 支持流式（可选，Node runtime 也支持）
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();

  try {
    const { message, scenarioId, userId, conversationId } = await req.json();

    // 参数校验
    if (!message || typeof message !== "string") {
      return new Response(JSON.stringify({ error: "message 不能为空" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (!userId || typeof userId !== "string") {
      return new Response(JSON.stringify({ error: "userId 不能为空" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 敏感词过滤 → 直接返回一次性 SSE
    if (BANNED_KEYWORDS.some((kw) => message.includes(kw))) {
      const restrictedStream = new ReadableStream({
        start(controller) {
          const payload = {
            type: "restricted",
            content: "我是专注韩语学习的 Onni，这个话题我们换一下吧～你今天想练哪个场景？",
          };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
          controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
          controller.close();
        },
      });
      return new Response(restrictedStream, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    }

    // 构造 Coze 流式请求
    const payload: any = {
      bot_id: BOT_ID,
      user_id: userId,
      stream: true,
      auto_save_history: true,
      additional_messages: [
        {
          role: "user",
          content: message,
          content_type: "text",
        },
      ],
      custom_variables: {
        current_scenario: scenarioId || "01",
      },
    };
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

    if (!cozeResp.ok || !cozeResp.body) {
      const errorText = await cozeResp.text().catch(() => "");
      console.error("扣子 API 请求失败:", errorText);
      return new Response(JSON.stringify({ error: "扣子服务暂时不可用" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 转发 Coze SSE → 前端 SSE
    const cozeReader = cozeResp.body.getReader();
    const decoder = new TextDecoder();

    const proxyStream = new ReadableStream({
      async start(controller) {
        let buffer = "";
        let currentEvent = "";
        let sentConvId = false;

        try {
          while (true) {
            const { done, value } = await cozeReader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const rawLine of lines) {
              const line = rawLine.trim();
              if (!line) continue;

              if (line.startsWith("event:")) {
                currentEvent = line.slice(6).trim();
                continue;
              }

              if (!line.startsWith("data:")) continue;
              const data = line.slice(5).trim();
              if (!data || data === "[DONE]") continue;

              let parsed: any;
              try {
                parsed = JSON.parse(data);
              } catch {
                continue;
              }

              // conversation_id：第一次拿到就转给前端
              if (!sentConvId && parsed.conversation_id) {
                sentConvId = true;
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({ type: "conversation_id", value: parsed.conversation_id })}\n\n`
                  )
                );
              }

              // delta：AI 回答的增量文本 → 直接转发内容（过滤空内容）
              if (
                currentEvent === "conversation.message.delta" &&
                parsed.type === "answer" &&
                typeof parsed.content === "string" &&
                parsed.content.length > 0
              ) {
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({ type: "delta", content: parsed.content })}\n\n`
                  )
                );
              }

              // 完整消息（作为兜底：如果 delta 中间丢失，用这条替换）
              if (
                currentEvent === "conversation.message.completed" &&
                parsed.type === "answer" &&
                typeof parsed.content === "string" &&
                parsed.content.length > 0
              ) {
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({ type: "completed", content: parsed.content })}\n\n`
                  )
                );
              }

              // 会话失败事件
              if (currentEvent === "conversation.chat.failed" || parsed.last_error) {
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({ type: "error", message: parsed.last_error?.msg || "对话失败" })}\n\n`
                  )
                );
              }
            }
          }

          controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
          controller.close();
        } catch (e) {
          console.error("流式转发出错:", e);
          try {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: "error", message: String(e) })}\n\n`)
            );
            controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
          } catch {}
          controller.close();
        }
      },
      cancel() {
        cozeReader.cancel().catch(() => {});
      },
    });

    return new Response(proxyStream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no", // Nginx/Vercel 禁用响应缓冲
      },
    });
  } catch (error) {
    console.error("API 代理层未捕获异常:", error);
    return new Response(JSON.stringify({ error: "服务器内部错误" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
