"use client";

import { useState, useEffect, useRef, CSSProperties } from "react";
import { initAnalytics, identifyUser, track } from "./lib/analytics";

const scenarios = [
  {
    id: "01",
    name: "第一次见面",
    emoji: "👋",
    opening: "안녕하세요, 처음 뵙겠습니다. 이름이 어떻게 되세요?",
    openingTranslation: "你好，初次见面。请问你叫什么名字？",
    placeholder: "例：'很高兴认识你' 用韩语怎么说",
    starters: [
      "'很高兴认识你' 用韩语怎么说",
      "怎么用韩语问别人年龄",
      "加微信/联系方式用韩语怎么说",
    ],
  },
  {
    id: "02",
    name: "咖啡店点单",
    emoji: "☕",
    opening: "어서 오세요! 뭐 드릴까요?",
    openingTranslation: "欢迎光临！有什么可以为您服务的吗？",
    placeholder: "例：'冰美式' 用韩语怎么说",
    starters: [
      "'冰美式' 用韩语怎么说",
      "'加冰、少糖' 用韩语怎么说",
      "'外带' 用韩语怎么说",
    ],
  },
  {
    id: "03",
    name: "粉丝签售会",
    emoji: "⭐",
    opening: "안녕하세요! 팬이에요. 사인해 주세요!",
    openingTranslation: "你好！我是粉丝。请给我签个名吧！",
    placeholder: "例：'我是你的粉丝' 用韩语怎么说",
    starters: [
      "'我是你的粉丝' 用韩语怎么说",
      "'请给我签名' 用韩语怎么说",
      "'我最爱你' 用韩语怎么说",
    ],
  },
  {
    id: "04",
    name: "旅游问路",
    emoji: "🗺️",
    opening: "안녕하세요, 길을 잃었어요. 명동으로 가는 길을 알려주세요.",
    openingTranslation: "你好，我迷路了。请告诉我去明洞的路怎么走。",
    placeholder: "例：'地铁怎么坐' 用韩语怎么说",
    starters: [
      "'地铁怎么坐' 用韩语怎么说",
      "打车常用韩语",
      "'去哪里' 用韩语怎么问",
    ],
  },
  {
    id: "05",
    name: "餐厅点菜",
    emoji: "🍜",
    opening: "안녕하세요! 메뉴판 좀 볼 수 있을까요?",
    openingTranslation: "你好！能给我看一下菜单吗？",
    placeholder: "例：'不要辣' 用韩语怎么说",
    starters: [
      "'不要辣' 用韩语怎么说",
      "'再来一份' 用韩语怎么说",
      "'结账' 用韩语怎么说",
    ],
  },
];

type Message = {
  role: "user" | "assistant";
  content: string;
  correctionCard?: any;
  retryable?: boolean; // 出错时可点重试
  retryQuery?: string; // 出错时保存原始 query 供重试
};

// ============ 智能内容解析 ============
type Block =
  | { type: "text"; content: string }
  | { type: "vocab"; content: string }
  | { type: "grammar"; content: string }
  | { type: "correction"; content: string }
  | { type: "hook"; content: string };

function parseBlocks(raw: string): Block[] {
  if (!raw) return [];

  // 清洗 markdown 和 AI 泄漏的内部标签
  raw = raw
    .replace(/```[a-z]*\n?/gi, "")
    .replace(/```/g, "")
    .replace(/^#{1,6}\s*/gm, "") // 去掉行首 ### / ## / #
    .replace(/^▶\s*/gm, "· ") // ▶ 转成 ·
    .replace(/^---+$/gm, "") // 单独一行的 ---
    .replace(/\*\*(.+?)\*\*/g, "$1") // 去掉 **粗体**
    // 剥掉 AI 泄漏的段落标签
    .replace(/^\s*[①②③④⑤⑥⑦⑧⑨⑩]\s*(场景例句|生词卡片|关键词卡片|语法(小贴士|点讲解|点)?|互动引导|温柔纠错|钩子问题|钩子|例句)?\s*[（(][^）)]*[）)]?\s*[：:]?\s*$/gm, "")
    .replace(/^\s*[①②③④⑤⑥⑦⑧⑨⑩]\s*(场景例句|生词卡片|关键词卡片|语法(小贴士|点讲解|点)?|互动引导|温柔纠错|钩子问题|钩子|例句)\s*[：:]?\s*/gm, "")
    // 关键修复：如果 👇 后紧跟数字编号（"2." "3." "①②③"），说明是错放，还原成普通编号
    .replace(/👇\s*(\d+\s*[.、．])/g, "$1")
    .replace(/👇\s*([①②③④⑤⑥⑦⑧⑨⑩])/g, "$1")
    // 去掉钩子里的教学铺垫
    .replace(/👇\s*.*?[。.～~]\s*(要不要试试|要不要试着|要不要|想不想)/g, "👇 $1")
    // 去掉多余空行
    .replace(/\n{3,}/g, "\n\n");

  const lines = raw.split("\n");
  const blocks: Block[] = [];
  let buffer: string[] = [];
  let mode: Block["type"] = "text";

  const flush = () => {
    const text = buffer.join("\n").trim();
    if (text) blocks.push({ type: mode, content: text });
    buffer = [];
  };

  for (const line of lines) {
    const l = line.trim();

    if (l.startsWith("👇")) {
      flush();
      mode = "hook";
      buffer.push(line);
      continue;
    }

    // 生词卡：emoji 或中文"生词/关键词/单词"标题
    if (
      l.startsWith("📇") ||
      l.startsWith("📌") ||
      /^(①|②|③|④|⑤)?\s*生词卡片/.test(l) ||
      /^(①|②|③|④|⑤)?\s*关键词/.test(l) ||
      /^(①|②|③|④|⑤)?\s*核心生词/.test(l)
    ) {
      flush();
      mode = "vocab";
      buffer.push(line);
      continue;
    }

    // 语法卡：emoji 或中文"语法"标题
    if (
      l.startsWith("📚") ||
      l.startsWith("【") ||
      /^(①|②|③|④|⑤)?\s*语法(小贴士|讲解|点)?/.test(l)
    ) {
      if (mode !== "grammar") {
        flush();
        mode = "grammar";
      }
      buffer.push(line);
      continue;
    }

    // 纠错卡
    if (
      l.startsWith("🌸") ||
      /^(①|②|③|④|⑤)?\s*(温柔)?纠错/.test(l)
    ) {
      flush();
      mode = "correction";
      buffer.push(line);
      continue;
    }

    if (l === "" && buffer.length > 0) {
      buffer.push("");
      continue;
    }

    if (
      (mode === "vocab" || mode === "grammar" || mode === "correction") &&
      !l.startsWith("📇") &&
      !l.startsWith("📌") &&
      !l.startsWith("📚") &&
      !l.startsWith("🌸") &&
      !l.startsWith("【") &&
      !l.startsWith("·") &&
      !l.startsWith("-") &&
      !l.startsWith("•")
    ) {
      if (l.length > 0 && buffer.length > 3) {
        flush();
        mode = "text";
      }
    }

    buffer.push(line);
  }
  flush();

  const filtered = blocks.filter((b) => b.content.length > 0);

  // 兜底：检查最后一个 block 的【最后一段】——不管是 text / vocab / grammar / correction
  // 因为 AI 常把追问混进语法/生词卡里，需要从段落粒度切出钩子
  if (filtered.length > 0) {
    const last = filtered[filtered.length - 1];
    // 已经是 hook 就不处理
    if (last.type !== "hook") {
      const lines = last.content.split(/\n/);

      // 从底部向上找"最后一段"（空行分隔）
      const lastPara: string[] = [];
      let hitBlank = false;
      for (let i = lines.length - 1; i >= 0; i--) {
        const l = lines[i].trim();
        if (l === "") {
          if (lastPara.length > 0) {
            hitBlank = true;
            break;
          }
        } else {
          lastPara.unshift(lines[i]);
        }
      }

      const paraText = lastPara.join("\n").trim();
      const beforeText = lines
        .slice(0, lines.length - lastPara.length)
        .join("\n")
        .trim();

      // 检测这一段像不像钩子
      const hasQuestionMark = /[？?]/.test(paraText);
      const startsWithHookCue = /^(要不要|想不想|试试|来试试|试着|想学|来练|来说说|你也|你能|你会)/.test(paraText);
      const hasFollowupCue =
        /(吗|呢|还想|还有|比如|试试|要不要|想学|下一句|怎么说|哪个|想不想|要不|试着)/.test(paraText);
      const hasSoftEnding = /[呀吧哦嘛~～!！]\s*[😊😉👍✨🌸💡🎉☕🛍️🚇👋]*\s*$/.test(paraText);
      const lengthOk = paraText.length >= 4 && paraText.length < 100;

      const isHook =
        (hasQuestionMark && hasFollowupCue && lengthOk) ||
        (startsWithHookCue && hasSoftEnding && lengthOk) ||
        (startsWithHookCue && hasQuestionMark && lengthOk);

      if (isHook && paraText.length > 0) {
        const hookContent = paraText.startsWith("👇") ? paraText : `👇 ${paraText}`;
        // 前面还有内容 → 保持原 block 类型，拆钩子出来；否则整个升级
        if (beforeText && hitBlank) {
          filtered[filtered.length - 1] = { type: last.type, content: beforeText };
          filtered.push({ type: "hook", content: hookContent });
        } else {
          filtered[filtered.length - 1] = { type: "hook", content: hookContent };
        }
      }
    }
  }

  // 关键修复 2：如果钩子超长（>60 字）或含多个问号，只保留最后一句问句
  // 这样即使 AI 把整段解释都放进钩子，前端也能救回来
  for (let i = 0; i < filtered.length; i++) {
    const b = filtered[i];
    if (b.type !== "hook") continue;

    const raw = b.content.replace(/^👇\s*/, "").trim();
    const questionMarks = (raw.match(/[？?]/g) || []).length;

    // 触发条件：长度超 60 字 或 含 2+ 个问号 → 只取最后一句问句
    if (raw.length > 60 || questionMarks >= 2) {
      // 按标点分割成句子
      const sentences = raw.split(/[。！!]|\s+—\s+|(?<=[？?])\s*/).filter(s => s.trim().length > 0);
      // 找到最后一个含问号的短句
      let lastQuestion = "";
      for (let j = sentences.length - 1; j >= 0; j--) {
        const s = sentences[j].trim();
        if (/[？?]/.test(s) && s.length <= 40) {
          lastQuestion = s;
          break;
        }
      }
      // 如果没找到合适的短问句，退回把这个 block 变成普通文本
      if (lastQuestion) {
        filtered[i] = { type: "hook", content: `👇 ${lastQuestion}` };
      } else {
        // 拿不到干净的钩子 → 干脆当成普通文本渲染，不显示钩子按钮
        filtered[i] = { type: "text", content: raw };
      }
    }
  }

  return filtered;
}

// 从钩子文本里抽取"可以问什么" —— 转换为清晰的单一问题
function extractHookQuery(hookText: string): string {
  let text = hookText.replace(/^👇\s*/, "").trim();

  // 剥掉泄漏的段落标签（如 "④ 互动引导"）
  text = text
    .replace(/^\s*[①②③④⑤⑥⑦⑧⑨⑩]\s*(互动引导|钩子问题|钩子|场景例句|生词卡片|语法小贴士|温柔纠错)?\s*[：:]?\s*/g, "")
    .trim();

  // 去掉末尾的 emoji
  text = text.replace(/[🎯☕🛍️🚇👋🌸😉👍🎓💡✨🎉📇📚]+\s*$/g, "").trim();

  // 去掉教学铺垫（"下次...就可以... 要不要..." → 只保留"要不要..."部分）
  const preambleMatch = text.match(/^.*?[。.～~]\s*(要不要试试|要不要试着|要不要|想不想学|想不想|试试|想学|试着)\s*(.+)$/);
  if (preambleMatch && preambleMatch[2]) {
    text = preambleMatch[1] + " " + preambleMatch[2];
    // 只保留铺垫后的问句
    text = preambleMatch[2].trim();
  }

  // 复合问句：包含 "或者" 拆分的两段问题 → 只取第一段
  const orSplit = text.split(/[?？]\s*[，,]?\s*或者[^？?]*[?？]?/);
  if (orSplit.length > 1 && orSplit[0].length > 0) {
    text = orSplit[0].trim() + "？";
  }

  // 引号内的具体句子 → "要不要试试'你好我叫XX'呀" → "你好我叫XX 用韩语怎么说？"
  const quoteMatch = text.match(/[「""'']([^「」""'']{2,60})[」""'']/);
  if (quoteMatch && quoteMatch[1]) {
    return `${quoteMatch[1].trim()} 用韩语怎么说？`;
  }

  // "还有 XX 想学吗？比如 A、B、C" → 抽取第一个选项
  const bihuMatch = text.match(/比如\s*[「"'']?([^、,，。！？!?」"'']+)/);
  if (bihuMatch && bihuMatch[1]) {
    return `${bihuMatch[1].trim()} 怎么说？`;
  }

  // "要不要试试 X？" / "想不想学 X？" → 改写为 "X 怎么说？"
  const tryMatch = text.match(
    /^(要不要试试|想不想学|要不要|想不想|试试|想学|试着)\s*[「"'']?([^？?」"'']+)[？?]?$/
  );
  if (tryMatch && tryMatch[2]) {
    const target = tryMatch[2].trim();
    // 已经是完整问句就直接用，否则包装
    if (/怎么|如何|哪个|什么|多少|吗$|呢$/.test(target)) {
      return target.replace(/[?？]$/, "") + "？";
    }
    return `${target} 用韩语怎么说？`;
  }

  // 默认：只清理引号和末尾无意义标点
  return text.replace(/[」"'']/g, "").trim();
}

// ============ UI ============
export default function Home() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string>("");
  const [currentScenario, setCurrentScenario] = useState<string>("01");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastHookAtRef = useRef<number | null>(null); // 上次收到钩子的时间戳

  // 初始化埋点 + 用户 ID
  useEffect(() => {
    initAnalytics();
    let uid = localStorage.getItem("onni_user_id");
    if (!uid) {
      uid = `user_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      localStorage.setItem("onni_user_id", uid);
    }
    setUserId(uid);
    identifyUser(uid);
  }, []);

  // 自动滚到底
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [messages, loading]);

  const switchScenario = (scenarioId: string, isInitial = false) => {
    const scenario = scenarios.find((s) => s.id === scenarioId);
    if (!scenario) return;

    setCurrentScenario(scenarioId);
    setConversationId(null);
    setMessages([
      {
        role: "assistant",
        content: `${scenario.opening}\n\n（${scenario.openingTranslation}）\n\n👇 试着回一句韩语吧～`,
      },
    ]);
    lastHookAtRef.current = Date.now(); // 场景切换后开场白也是个钩子

    if (!isInitial) {
      track("scenario_selected", {
        scenario_id: scenarioId,
        scenario_name: scenario.name,
      });
    }
  };

  useEffect(() => {
    if (userId) switchScenario("01", true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // 钩子点击 → 填充输入框 + 埋点
  const handleHookClick = (hookText: string) => {
    const query = extractHookQuery(hookText);
    setInput(query);
    inputRef.current?.focus();
    track("hook_clicked", {
      hook_text: hookText.slice(0, 100),
      scenario_id: currentScenario,
    });
  };

  // 核心：把发送逻辑抽出来，便于重试复用
  async function sendQueryToBackend(query: string, isRetry = false) {
    if (!userId) return;

    // 首次发送时才 push user msg + 埋点，重试时跳过（避免重复气泡）
    if (!isRetry) {
      const userMsg: Message = { role: "user", content: query };
      setMessages((prev) => [...prev, userMsg]);

      const timeSinceHook = lastHookAtRef.current
        ? Date.now() - lastHookAtRef.current
        : null;
      track("message_sent", {
        scenario_id: currentScenario,
        message_length: query.length,
        contains_korean: /[ㄱ-힝]/.test(query),
        time_since_hook_ms: timeSinceHook,
      });
      if (timeSinceHook !== null && timeSinceHook <= 30000) {
        track("hook_followup", {
          scenario_id: currentScenario,
          seconds_since_hook: Math.round(timeSinceHook / 1000),
        });
      }
    } else {
      // 重试时先移除上一条失败消息
      setMessages((prev) => prev.filter((m) => !m.retryable));
    }

    setLoading(true);
    const startedAt = Date.now();

    // 45 秒超时保护（给 Coze 一些缓冲，避免误判超时）
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: query,
          scenarioId: currentScenario,
          userId,
          conversationId,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const data = await res.json();
      const latency = Date.now() - startedAt;

      if (data.is_restricted) {
        setMessages((prev) => [...prev, { role: "assistant", content: data.onni_reply }]);
        track("restricted_topic", { scenario_id: currentScenario });
        return;
      }

      if (data.conversation_id) setConversationId(data.conversation_id);

      const assistantMsg: Message = { role: "assistant", content: data.onni_reply };
      if (data.correction_card) {
        try {
          assistantMsg.correctionCard = JSON.parse(data.correction_card);
        } catch {}
      }
      setMessages((prev) => [...prev, assistantMsg]);

      if (data.onni_reply && data.onni_reply.includes("👇")) {
        lastHookAtRef.current = Date.now();
      } else {
        lastHookAtRef.current = null;
      }

      track("onni_replied", {
        scenario_id: currentScenario,
        latency_ms: latency,
        reply_length: (data.onni_reply || "").length,
        has_hook: (data.onni_reply || "").includes("👇"),
        has_correction: !!data.correction_card,
      });
    } catch (e: any) {
      clearTimeout(timeoutId);
      const isTimeout = e?.name === "AbortError";
      const errorContent = isTimeout
        ? "Onni 有点跟不上啦～ ⏱️ 网络或模型响应慢，点下方重试一下吧"
        : "网络不太给力，稍等再试～ 🥺";

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: errorContent,
          retryable: true,
          retryQuery: query,
        },
      ]);
      track("chat_error", {
        scenario_id: currentScenario,
        is_timeout: isTimeout,
        error: String(e).slice(0, 200),
      });
    } finally {
      setLoading(false);
    }
  }

  // 首次发送入口（从输入框触发）
  function sendMessage() {
    if (!input.trim() || !userId || loading) return;
    const query = input;
    setInput("");
    sendQueryToBackend(query, false);
  }

  // 重试入口（点击重试按钮触发）
  function handleRetry(retryQuery: string) {
    if (loading) return;
    sendQueryToBackend(retryQuery, true);
  }

  const currentScene = scenarios.find((s) => s.id === currentScenario);

  return (
    <div className="gradient-bg" style={styles.app}>
      {/* === 顶栏 === */}
      <header style={styles.header}>
        <div style={styles.headerInner}>
          <div style={styles.logo}>
            <div style={styles.logoIcon}>오니</div>
            <div>
              <h1 style={styles.brandName}>Onni</h1>
              <p style={styles.tagline}>你的韩国学姐 · 陪你练开口 🌸</p>
            </div>
          </div>
        </div>

        <div style={styles.chipRow}>
          <div style={styles.chipInner}>
            {scenarios.map((s) => {
              const active = currentScenario === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => switchScenario(s.id)}
                  style={{
                    ...styles.chip,
                    ...(active ? styles.chipActive : {}),
                  }}
                >
                  <span style={{ fontSize: 16 }}>{s.emoji}</span>
                  <span>{s.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      </header>

      {/* === 场景条 === */}
      <div style={styles.sceneBar}>
        <span style={styles.sceneBarText}>
          <span style={{ fontSize: 14 }}>{currentScene?.emoji}</span>
          <span>
            当前场景：<strong style={{ color: "var(--ink)" }}>{currentScene?.name}</strong>
          </span>
          <span style={{ color: "var(--ink-3)", marginLeft: 6 }}>· {messages.length} 条对话</span>
        </span>
      </div>

      {/* === 消息区 === */}
      <main ref={scrollRef} style={styles.chatArea}>
        <div style={styles.chatInner}>
          {messages.map((m, i) => (
            <MessageBubble
              key={i}
              msg={m}
              onHookClick={handleHookClick}
              onRetry={handleRetry}
            />
          ))}
          {loading && <TypingIndicator />}
        </div>
      </main>

      {/* === 输入区 === */}
      <footer style={styles.inputBar}>
        {/* 场景快捷提问（只在对话较少时显示，避免遮挡） */}
        {currentScene?.starters && messages.length <= 2 && (
          <div style={styles.startersRow}>
            {currentScene.starters.map((s, idx) => (
              <button
                key={idx}
                onClick={() => {
                  setInput(s);
                  inputRef.current?.focus();
                }}
                style={styles.starterChip}
              >
                <span style={{ opacity: 0.55, marginRight: 4 }}>💬</span>
                {s}
              </button>
            ))}
          </div>
        )}

        <div style={styles.inputWrap}>
          <input
            ref={inputRef}
            style={styles.input}
            placeholder={currentScene?.placeholder || "想说什么？"}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
            disabled={loading}
          />
          <button
            onClick={sendMessage}
            disabled={loading || !input.trim()}
            style={{
              ...styles.sendBtn,
              ...(loading || !input.trim() ? styles.sendBtnDisabled : {}),
            }}
            aria-label="发送"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M3 20L21 12L3 4L3 11L15 12L3 13L3 20Z" fill="currentColor" />
            </svg>
          </button>
        </div>
        <p style={styles.footerHint}>💡 点击 👇 问题可以一键跟进；输入韩语句子 Onni 会帮你纠错</p>
      </footer>
    </div>
  );
}

// ============ 消息气泡 ============
function MessageBubble({
  msg,
  onHookClick,
  onRetry,
}: {
  msg: Message;
  onHookClick: (hook: string) => void;
  onRetry: (retryQuery: string) => void;
}) {
  const isUser = msg.role === "user";
  const blocks = isUser ? [] : parseBlocks(msg.content);

  return (
    <div
      className="msg-enter"
      style={{
        display: "flex",
        flexDirection: isUser ? "row-reverse" : "row",
        gap: 10,
        marginBottom: 20,
        alignItems: "flex-start",
      }}
    >
      {!isUser && (
        <div style={styles.avatar}>
          <span style={{ fontSize: 18 }}>🌸</span>
        </div>
      )}
      {isUser && (
        <div style={styles.userAvatar}>
          <span style={{ fontSize: 14, fontWeight: 600, color: "#fff" }}>나</span>
        </div>
      )}
      <div
        style={{
          maxWidth: "78%",
          display: "flex",
          flexDirection: "column",
          gap: 8,
          alignItems: isUser ? "flex-end" : "flex-start",
        }}
      >
        {isUser ? (
          <div style={styles.userBubble}>{msg.content}</div>
        ) : (
          <>
            {blocks.length === 0 ? (
              <div style={styles.aiBubble}>{msg.content}</div>
            ) : (
              blocks.map((b, idx) => <BlockCard key={idx} block={b} onHookClick={onHookClick} />)
            )}
          </>
        )}

        {msg.correctionCard && (
          <div style={styles.correctionCard}>
            <div style={styles.cardHeader}>
              <span>🌸</span>
              <span style={{ fontWeight: 600 }}>纠错卡</span>
            </div>
            <pre style={styles.pre}>{JSON.stringify(msg.correctionCard, null, 2)}</pre>
          </div>
        )}

        {msg.retryable && msg.retryQuery && (
          <button
            onClick={() => onRetry(msg.retryQuery!)}
            style={styles.retryBtn}
          >
            <span style={{ marginRight: 4 }}>🔄</span> 重试
          </button>
        )}
      </div>
    </div>
  );
}

// ============ 分块渲染 ============
function BlockCard({
  block,
  onHookClick,
}: {
  block: Block;
  onHookClick: (hook: string) => void;
}) {
  switch (block.type) {
    case "text":
      return <div style={styles.aiBubble}>{block.content}</div>;
    case "vocab":
      return (
        <div style={styles.vocabCard}>
          <div style={styles.cardHeader}>
            <span>📇</span>
            <span style={{ fontWeight: 600, color: "var(--accent)" }}>关键词</span>
          </div>
          <div style={styles.cardBody}>{block.content.replace(/^📇.*\n?/, "")}</div>
        </div>
      );
    case "grammar":
      return (
        <div style={styles.grammarCard}>
          <div style={styles.cardHeader}>
            <span>📚</span>
            <span style={{ fontWeight: 600, color: "var(--success)" }}>语法小贴士</span>
          </div>
          <div style={styles.cardBody}>{block.content.replace(/^📚.*\n?/, "")}</div>
        </div>
      );
    case "correction":
      return (
        <div style={styles.correctionCard}>
          <div style={styles.cardHeader}>
            <span>🌸</span>
            <span style={{ fontWeight: 600, color: "var(--warn)" }}>温柔纠错</span>
          </div>
          <div style={styles.cardBody}>{block.content.replace(/^🌸.*\n?/, "")}</div>
        </div>
      );
    case "hook":
      return <HookButton content={block.content} onClick={onHookClick} />;
  }
}

// ============ 钩子按钮 ============
function HookButton({
  content,
  onClick,
}: {
  content: string;
  onClick: (hook: string) => void;
}) {
  const [hover, setHover] = useState(false);
  const [pressed, setPressed] = useState(false);

  return (
    <button
      onClick={() => onClick(content)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => {
        setHover(false);
        setPressed(false);
      }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      style={{
        ...styles.hookButton,
        ...(hover ? styles.hookButtonHover : {}),
        ...(pressed ? styles.hookButtonPressed : {}),
      }}
    >
      <span style={{ flex: 1, textAlign: "left" }}>{content}</span>
      <span style={styles.hookArrow}>→</span>
    </button>
  );
}

// ============ Loading 打字动画 ============
function TypingIndicator() {
  return (
    <div className="fade-in" style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 20 }}>
      <div style={styles.avatar}>
        <span style={{ fontSize: 18 }}>🌸</span>
      </div>
      <div style={{ ...styles.aiBubble, padding: "14px 18px" }}>
        <span className="typing-dot" />
        <span className="typing-dot" />
        <span className="typing-dot" />
      </div>
    </div>
  );
}

// ============ 样式 ============
const styles: Record<string, CSSProperties> = {
  app: {
    height: "100vh",
    display: "flex",
    flexDirection: "column",
    maxWidth: 720,
    margin: "0 auto",
    position: "relative",
  },

  header: {
    padding: "20px 20px 0",
    flexShrink: 0,
  },
  headerInner: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  logo: {
    display: "flex",
    gap: 12,
    alignItems: "center",
  },
  logoIcon: {
    width: 44,
    height: 44,
    background: "linear-gradient(135deg, var(--brand) 0%, #FF9DB4 100%)",
    borderRadius: 14,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#fff",
    fontWeight: 700,
    fontSize: 15,
    boxShadow: "0 6px 18px var(--brand-glow)",
    letterSpacing: "-0.5px",
  },
  brandName: {
    fontSize: 22,
    fontWeight: 700,
    color: "var(--ink)",
    letterSpacing: "-0.5px",
    lineHeight: 1.1,
  },
  tagline: {
    fontSize: 12,
    color: "var(--ink-2)",
    marginTop: 2,
  },

  chipRow: {
    marginTop: 4,
    marginLeft: -20,
    marginRight: -20,
    padding: "0 20px",
    overflowX: "auto",
    scrollbarWidth: "none",
  },
  chipInner: {
    display: "flex",
    gap: 8,
    paddingBottom: 8,
  },
  chip: {
    flex: "0 0 auto",
    padding: "8px 14px",
    borderRadius: "var(--r-pill)",
    background: "var(--bg-card)",
    color: "var(--ink-2)",
    fontSize: 13,
    fontWeight: 500,
    display: "flex",
    alignItems: "center",
    gap: 6,
    border: "1px solid var(--border)",
    transition: "all 0.2s",
    whiteSpace: "nowrap",
  },
  chipActive: {
    background: "linear-gradient(135deg, var(--brand) 0%, #FF9DB4 100%)",
    color: "#fff",
    fontWeight: 600,
    border: "1px solid transparent",
    boxShadow: "0 4px 14px var(--brand-glow)",
  },

  sceneBar: {
    padding: "10px 20px 6px",
    flexShrink: 0,
  },
  sceneBarText: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    color: "var(--ink-2)",
    background: "var(--bg-card)",
    padding: "6px 12px",
    borderRadius: "var(--r-pill)",
    border: "1px solid var(--border)",
  },

  chatArea: {
    flex: 1,
    overflowY: "auto",
    padding: "10px 20px 20px",
  },
  chatInner: {
    display: "flex",
    flexDirection: "column",
  },
  avatar: {
    width: 34,
    height: 34,
    background: "linear-gradient(135deg, #FFE0E8 0%, #FFF6F0 100%)",
    borderRadius: 12,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    boxShadow: "var(--shadow-sm)",
    border: "1px solid var(--border)",
  },
  userAvatar: {
    width: 34,
    height: 34,
    background: "linear-gradient(135deg, #7C6DFF 0%, #A99CFF 100%)",
    borderRadius: 12,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    boxShadow: "0 4px 12px rgba(124, 109, 255, 0.25)",
  },

  userBubble: {
    background: "linear-gradient(135deg, var(--brand) 0%, #FF8FA8 100%)",
    color: "#fff",
    padding: "12px 18px",
    borderRadius: "18px 18px 4px 18px",
    fontSize: 15,
    lineHeight: 1.55,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    boxShadow: "0 4px 14px var(--brand-glow)",
    maxWidth: "100%",
  },
  aiBubble: {
    background: "var(--bg-card)",
    color: "var(--ink)",
    padding: "12px 18px",
    borderRadius: "4px 18px 18px 18px",
    fontSize: 15,
    lineHeight: 1.65,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    boxShadow: "var(--shadow-sm)",
    border: "1px solid var(--border)",
  },

  // === 钩子按钮 ===
  hookButton: {
    background: "linear-gradient(135deg, var(--brand-soft) 0%, #FFF0E5 100%)",
    color: "var(--brand-dark)",
    padding: "12px 16px",
    borderRadius: 14,
    fontSize: 14,
    fontWeight: 500,
    lineHeight: 1.5,
    border: "1px solid rgba(255, 107, 138, 0.2)",
    display: "flex",
    alignItems: "center",
    gap: 8,
    textAlign: "left",
    width: "100%",
    cursor: "pointer",
    transition: "all 0.2s ease",
    boxShadow: "0 2px 8px rgba(255, 107, 138, 0.08)",
  },
  hookButtonHover: {
    background: "linear-gradient(135deg, #FFD4E0 0%, #FFE8D4 100%)",
    borderColor: "rgba(255, 107, 138, 0.4)",
    boxShadow: "0 4px 14px rgba(255, 107, 138, 0.18)",
    transform: "translateY(-1px)",
  },
  hookButtonPressed: {
    transform: "translateY(0) scale(0.98)",
    boxShadow: "0 2px 6px rgba(255, 107, 138, 0.12)",
  },
  hookArrow: {
    fontSize: 16,
    fontWeight: 600,
    color: "var(--brand)",
    flexShrink: 0,
  },

  vocabCard: {
    background: "linear-gradient(135deg, #FDFBFF 0%, var(--accent-soft) 100%)",
    borderRadius: 14,
    padding: "12px 16px",
    border: "1px solid rgba(124, 109, 255, 0.15)",
    boxShadow: "0 4px 12px rgba(124, 109, 255, 0.06)",
    fontSize: 14,
  },
  grammarCard: {
    background: "linear-gradient(135deg, #FBFFFD 0%, var(--success-soft) 100%)",
    borderRadius: 14,
    padding: "12px 16px",
    border: "1px solid rgba(76, 175, 136, 0.15)",
    boxShadow: "0 4px 12px rgba(76, 175, 136, 0.06)",
    fontSize: 14,
  },
  correctionCard: {
    background: "linear-gradient(135deg, #FFFBF6 0%, var(--warn-soft) 100%)",
    borderRadius: 14,
    padding: "12px 16px",
    border: "1px solid rgba(245, 162, 93, 0.18)",
    boxShadow: "0 4px 12px rgba(245, 162, 93, 0.06)",
    fontSize: 14,
  },
  cardHeader: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 13,
    marginBottom: 8,
  },
  cardBody: {
    color: "var(--ink)",
    lineHeight: 1.65,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
  pre: {
    fontSize: 12,
    whiteSpace: "pre-wrap",
    color: "var(--ink-2)",
    fontFamily: "SFMono-Regular, Menlo, Consolas, monospace",
  },

  inputBar: {
    padding: "12px 20px 20px",
    background: "linear-gradient(180deg, transparent 0%, var(--bg-warm) 40%)",
    flexShrink: 0,
  },
  startersRow: {
    display: "flex",
    gap: 8,
    overflowX: "auto",
    paddingBottom: 10,
    marginLeft: -4,
    marginRight: -4,
    paddingLeft: 4,
    paddingRight: 4,
    scrollbarWidth: "none",
  },
  starterChip: {
    flex: "0 0 auto",
    padding: "8px 14px",
    borderRadius: "var(--r-pill)",
    background: "var(--bg-card)",
    color: "var(--ink-2)",
    fontSize: 13,
    fontWeight: 500,
    border: "1px solid var(--border)",
    boxShadow: "var(--shadow-sm)",
    whiteSpace: "nowrap",
    transition: "all 0.15s ease",
    display: "inline-flex",
    alignItems: "center",
  },
  retryBtn: {
    marginTop: 4,
    padding: "6px 14px",
    borderRadius: "var(--r-pill)",
    background: "var(--brand-soft)",
    color: "var(--brand-dark)",
    fontSize: 13,
    fontWeight: 500,
    border: "1px solid rgba(255, 107, 138, 0.25)",
    display: "inline-flex",
    alignItems: "center",
    cursor: "pointer",
    transition: "all 0.15s ease",
  },
  inputWrap: {
    display: "flex",
    gap: 10,
    alignItems: "center",
    background: "var(--bg-card)",
    borderRadius: "var(--r-pill)",
    padding: "6px 6px 6px 20px",
    boxShadow: "0 6px 20px rgba(42, 36, 56, 0.06)",
    border: "1px solid var(--border)",
    transition: "border-color 0.2s, box-shadow 0.2s",
  },
  input: {
    flex: 1,
    padding: "10px 0",
    fontSize: 15,
    background: "transparent",
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: "50%",
    background: "linear-gradient(135deg, var(--brand) 0%, #FF8FA8 100%)",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 4px 12px var(--brand-glow)",
    transition: "transform 0.15s, opacity 0.2s",
    flexShrink: 0,
  },
  sendBtnDisabled: {
    background: "var(--border-strong)",
    boxShadow: "none",
    cursor: "not-allowed",
  },
  footerHint: {
    marginTop: 8,
    fontSize: 11,
    color: "var(--ink-3)",
    textAlign: "center",
  },
};
