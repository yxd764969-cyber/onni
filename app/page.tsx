"use client";

import { useState, useEffect } from "react";

const scenarios = [
  { 
    id: "01", 
    name: "第一次见面", 
    emoji: "👋",
    opening: "안녕하세요, 처음 뵙겠습니다. 이름이 어떻게 되세요?",
    openingTranslation: "你好，初次见面。请问你叫什么名字？"
  },
  { 
    id: "02", 
    name: "咖啡店点单", 
    emoji: "☕",
    opening: "어서 오세요! 뭐 드릴까요?",
    openingTranslation: "欢迎光临！有什么可以为您服务的吗？"
  },
  { 
    id: "03", 
    name: "粉丝签售会", 
    emoji: "⭐",
    opening: "안녕하세요! 팬이에요. 사인해 주세요!",
    openingTranslation: "你好！我是粉丝。请给我签个名吧！"
  },
  { 
    id: "04", 
    name: "旅游问路", 
    emoji: "🗺️",
    opening: "안녕하세요, 길을 잃었어요. 명동으로 가는 길을 알려주세요.",
    openingTranslation: "你好，我迷路了。请告诉我去明洞的路怎么走。"
  },
  { 
    id: "05", 
    name: "餐厅点菜", 
    emoji: "🍜",
    opening: "안녕하세요! 메뉴판 좀 볼 수 있을까요?",
    openingTranslation: "你好！能给我看一下菜单吗？"
  },
];

export default function Home() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<{ role: string; content: string; correctionCard?: any }[]>([]);
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string>("");
  const [currentScenario, setCurrentScenario] = useState<string>("01");

  // 生成或读取用户 ID（存 localStorage）
  useEffect(() => {
    let uid = localStorage.getItem("onni_user_id");
    if (!uid) {
      uid = `user_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      localStorage.setItem("onni_user_id", uid);
    }
    setUserId(uid);
  }, []);

  // 🆕 切换场景时，自动发送开场白
  const switchScenario = (scenarioId: string) => {
    const scenario = scenarios.find(s => s.id === scenarioId);
    if (!scenario) return;

    setCurrentScenario(scenarioId);
    setConversationId(null);
    
    // 清空消息，然后插入开场白
    const openingMessage = {
      role: "assistant" as const,
      content: `${scenario.opening}\n\n（${scenario.openingTranslation}）`,
    };
    setMessages([openingMessage]);
  };

  // 初始化时自动发送第一个场景的开场白
  useEffect(() => {
    if (userId) {
      switchScenario("01");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  async function sendMessage() {
    if (!input.trim() || !userId) return;

    const userMsg = { role: "user" as const, content: input };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: input,
          scenarioId: currentScenario,
          userId: userId,
          conversationId: conversationId,
        }),
      });

      const data = await res.json();

      // 敏感词拦截
      if (data.is_restricted) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: data.onni_reply },
        ]);
        return;
      }

      // 更新 conversation_id 用于下一轮
      if (data.conversation_id) {
        setConversationId(data.conversation_id);
      }

      // 构造 assistant 消息
      const assistantMsg: any = { role: "assistant", content: data.onni_reply };
      if (data.correction_card) {
        try {
          assistantMsg.correctionCard = JSON.parse(data.correction_card);
        } catch {
          // 解析失败就当普通文本
        }
      }

      setMessages((prev) => [...prev, assistantMsg]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "出错了，请稍后再试。" },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 640, margin: "60px auto", padding: "0 16px", fontFamily: "sans-serif" }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 4 }}>Onni 오니</h1>
      <p style={{ color: "#666", marginBottom: 16 }}>你的 AI 韩语学习伙伴</p>

      {/* 场景选择器 */}
      <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 12, marginBottom: 16, flexWrap: "nowrap" }}>
        {scenarios.map((s) => (
          <button
            key={s.id}
            onClick={() => switchScenario(s.id)}
            style={{
              flex: "0 0 auto",
              padding: "6px 16px",
              borderRadius: 20,
              border: currentScenario === s.id ? "2px solid #0070f3" : "1px solid #ddd",
              background: currentScenario === s.id ? "#e6f0ff" : "#fff",
              cursor: "pointer",
              fontSize: 14,
              fontWeight: currentScenario === s.id ? 600 : 400,
              color: currentScenario === s.id ? "#0070f3" : "#333",
            }}
          >
            {s.emoji} {s.name}
          </button>
        ))}
      </div>

      {/* 当前场景提示 */}
      <p style={{ color: "#888", fontSize: 13, marginBottom: 12 }}>
        📍 当前场景：{scenarios.find(s => s.id === currentScenario)?.name}
        {messages.length > 0 && ` · ${messages.length} 条对话`}
      </p>

      <div style={{ border: "1px solid #e5e5e5", borderRadius: 12, padding: 16, minHeight: 300, marginBottom: 16 }}>
        {messages.length === 0 && (
          <p style={{ color: "#aaa", textAlign: "center", marginTop: 100 }}>
            안녕하세요！选择场景后开始对话吧～
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{ marginBottom: 12, textAlign: m.role === "user" ? "right" : "left" }}>
            <span
              style={{
                display: "inline-block",
                background: m.role === "user" ? "#0070f3" : "#f0f0f0",
                color: m.role === "user" ? "#fff" : "#111",
                borderRadius: 10,
                padding: "8px 14px",
                maxWidth: "80%",
                whiteSpace: "pre-wrap",
              }}
            >
              {m.content}
            </span>
            {/* 如果有纠错卡，渲染一个简单的卡片 */}
            {m.correctionCard && (
              <div style={{ marginTop: 8, background: "#fafafa", border: "1px solid #e5e5e5", borderRadius: 8, padding: 12 }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: "#666" }}>📝 纠错卡</div>
                <pre style={{ fontSize: 13, whiteSpace: "pre-wrap", marginTop: 4 }}>
                  {JSON.stringify(m.correctionCard, null, 2)}
                </pre>
              </div>
            )}
          </div>
        ))}
        {loading && <p style={{ color: "#aaa" }}>Onni 正在思考…</p>}
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <input
          style={{ flex: 1, padding: "10px 14px", borderRadius: 8, border: "1px solid #ddd", fontSize: 15 }}
          placeholder="输入问题，例如：'你好'用韩语怎么说？"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
        />
        <button
          onClick={sendMessage}
          disabled={loading}
          style={{
            padding: "10px 20px",
            background: "#0070f3",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            cursor: loading ? "not-allowed" : "pointer",
            fontSize: 15,
          }}
        >
          发送
        </button>
      </div>
    </main>
  );
}