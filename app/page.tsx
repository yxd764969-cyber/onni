"use client";

import { useState, useEffect, useRef, CSSProperties } from "react";

const scenarios = [
  {
    id: "01",
    name: "第一次见面",
    emoji: "👋",
    opening: "안녕하세요, 처음 뵙겠습니다. 이름이 어떻게 되세요?",
    openingTranslation: "你好，初次见面。请问你叫什么名字？",
  },
  {
    id: "02",
    name: "咖啡店点单",
    emoji: "☕",
    opening: "어서 오세요! 뭐 드릴까요?",
    openingTranslation: "欢迎光临！有什么可以为您服务的吗？",
  },
  {
    id: "03",
    name: "粉丝签售会",
    emoji: "⭐",
    opening: "안녕하세요! 팬이에요. 사인해 주세요!",
    openingTranslation: "你好！我是粉丝。请给我签个名吧！",
  },
  {
    id: "04",
    name: "旅游问路",
    emoji: "🗺️",
    opening: "안녕하세요, 길을 잃었어요. 명동으로 가는 길을 알려주세요.",
    openingTranslation: "你好，我迷路了。请告诉我去明洞的路怎么走。",
  },
  {
    id: "05",
    name: "餐厅点菜",
    emoji: "🍜",
    opening: "안녕하세요! 메뉴판 좀 볼 수 있을까요?",
    openingTranslation: "你好！能给我看一下菜单吗？",
  },
];

type Message = {
  role: "user" | "assistant";
  content: string;
  correctionCard?: any;
};

// ============ 智能内容解析：把 AI 回复拆成 段落 / 关键词卡 / 语法卡 / 纠错卡 / 钩子 ============
type Block =
  | { type: "text"; content: string }
  | { type: "vocab"; content: string }
  | { type: "grammar"; content: string }
  | { type: "correction"; content: string }
  | { type: "hook"; content: string };

function parseBlocks(raw: string): Block[] {
  if (!raw) return [];
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

    // 钩子：以 👇 开头的最后一句
    if (l.startsWith("👇")) {
      flush();
      mode = "hook";
      buffer.push(line);
      continue;
    }

    // 生词卡
    if (l.startsWith("📇") || l.startsWith("📌")) {
      flush();
      mode = "vocab";
      buffer.push(line);
      continue;
    }

    // 语法卡
    if (l.startsWith("📚") || l.startsWith("【")) {
      // 【】通常出现在语法讲解
      if (mode !== "grammar") {
        flush();
        mode = "grammar";
      }
      buffer.push(line);
      continue;
    }

    // 纠错卡
    if (l.startsWith("🌸")) {
      flush();
      mode = "correction";
      buffer.push(line);
      continue;
    }

    // 空行且当前 buffer 有内容 → flush 回到 text
    if (l === "" && buffer.length > 0) {
      buffer.push("");
      continue;
    }

    // 从特殊卡回到普通文本：遇到不属于特殊卡的行
    if ((mode === "vocab" || mode === "grammar" || mode === "correction") && !l.startsWith("📇") && !l.startsWith("📌") && !l.startsWith("📚") && !l.startsWith("🌸") && !l.startsWith("【") && !l.startsWith("·") && !l.startsWith("-") && !l.startsWith("•")) {
      // 判断这行是否明显是新段落
      if (l.length > 0 && buffer.length > 3) {
        flush();
        mode = "text";
      }
    }

    buffer.push(line);
  }
  flush();

  return blocks.filter((b) => b.content.length > 0);
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

  useEffect(() => {
    let uid = localStorage.getItem("onni_user_id");
    if (!uid) {
      uid = `user_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      localStorage.setItem("onni_user_id", uid);
    }
    setUserId(uid);
  }, []);

  // 自动滚到底
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [messages, loading]);

  const switchScenario = (scenarioId: string) => {
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
  };

  useEffect(() => {
    if (userId) switchScenario("01");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  async function sendMessage() {
    if (!input.trim() || !userId || loading) return;

    const userMsg: Message = { role: "user", content: input };
    setMessages((prev) => [...prev, userMsg]);
    const query = input;
    setInput("");
    setLoading(true);

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
      });

      const data = await res.json();

      if (data.is_restricted) {
        setMessages((prev) => [...prev, { role: "assistant", content: data.onni_reply }]);
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
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "网络不太给力，等一下再试～ 🥺" },
      ]);
    } finally {
      setLoading(false);
    }
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

        {/* 场景选择器 */}
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
          <span>当前场景：<strong style={{ color: "var(--ink)" }}>{currentScene?.name}</strong></span>
          <span style={{ color: "var(--ink-3)", marginLeft: 6 }}>· {messages.length} 条对话</span>
        </span>
      </div>

      {/* === 消息区 === */}
      <main ref={scrollRef} style={styles.chatArea}>
        <div style={styles.chatInner}>
          {messages.map((m, i) => (
            <MessageBubble key={i} msg={m} />
          ))}
          {loading && <TypingIndicator />}
        </div>
      </main>

      {/* === 输入区 === */}
      <footer style={styles.inputBar}>
        <div style={styles.inputWrap}>
          <input
            style={styles.input}
            placeholder="想说什么？例：'冰美式怎么说'"
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
              <path
                d="M3 20L21 12L3 4L3 11L15 12L3 13L3 20Z"
                fill="currentColor"
              />
            </svg>
          </button>
        </div>
        <p style={styles.footerHint}>💡 输入韩语句子 Onni 会帮你纠错；问「XX 怎么说」会给生词卡</p>
      </footer>
    </div>
  );
}

// ============ 消息气泡 ============
function MessageBubble({ msg }: { msg: Message }) {
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
      <div style={{ maxWidth: "78%", display: "flex", flexDirection: "column", gap: 8, alignItems: isUser ? "flex-end" : "flex-start" }}>
        {isUser ? (
          <div style={styles.userBubble}>{msg.content}</div>
        ) : (
          <>
            {blocks.length === 0 ? (
              <div style={styles.aiBubble}>{msg.content}</div>
            ) : (
              blocks.map((b, idx) => <BlockCard key={idx} block={b} />)
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
      </div>
    </div>
  );
}

// ============ 分块渲染 ============
function BlockCard({ block }: { block: Block }) {
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
      return <div style={styles.hookBubble}>{block.content}</div>;
    default:
      return <div style={styles.aiBubble}>{block.content}</div>;
  }
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

  // === Header ===
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

  // === 场景 chip 行 ===
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

  // === 场景条 ===
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

  // === 消息区 ===
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

  // === 气泡 ===
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
  hookBubble: {
    background: "linear-gradient(135deg, var(--brand-soft) 0%, #FFF0E5 100%)",
    color: "var(--brand-dark)",
    padding: "10px 16px",
    borderRadius: 14,
    fontSize: 14,
    fontWeight: 500,
    lineHeight: 1.5,
    whiteSpace: "pre-wrap",
    border: "1px solid rgba(255, 107, 138, 0.15)",
  },

  // === 卡片 ===
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

  // === 输入区 ===
  inputBar: {
    padding: "12px 20px 20px",
    background: "linear-gradient(180deg, transparent 0%, var(--bg-warm) 40%)",
    flexShrink: 0,
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
