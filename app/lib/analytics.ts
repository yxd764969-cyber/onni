"use client";

import posthog from "posthog-js";

// ==========================================
// Onni 埋点模块 · 统一事件命名 + 用户属性
// ==========================================

let initialized = false;

/**
 * 初始化 PostHog（layout 里调用一次）
 * 如果 env 里没配 KEY，会静默跳过（本地开发不需要装）
 */
export function initAnalytics() {
  if (typeof window === "undefined") return;
  if (initialized) return;

  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";

  if (!key) {
    console.log("[analytics] PostHog key 未配置，跳过初始化");
    return;
  }

  posthog.init(key, {
    api_host: host,
    person_profiles: "identified_only", // 只在 identify 后创建用户
    capture_pageview: true,
    capture_pageleave: true,
    autocapture: false, // 关闭自动点击埋点，我们只埋自定义事件
  });

  initialized = true;
}

/**
 * 关联用户 ID（用你已有的 onni_user_id）
 */
export function identifyUser(userId: string) {
  if (typeof window === "undefined" || !initialized) return;
  posthog.identify(userId);
}

/**
 * 统一事件类型（避免拼写错误）
 */
export type EventName =
  | "scenario_selected"      // 场景切换
  | "message_sent"           // 用户发消息
  | "onni_replied"           // 收到 Onni 回复
  | "hook_clicked"           // 用户点了钩子问题
  | "hook_followup"          // 用户看到钩子 30s 内发了下一条
  | "chat_error"             // 请求失败
  | "restricted_topic";      // 触发敏感话题拦截

/**
 * 发送事件到 PostHog
 */
export function track(name: EventName, props?: Record<string, any>) {
  if (typeof window === "undefined" || !initialized) return;
  posthog.capture(name, {
    ...props,
    timestamp: new Date().toISOString(),
  });
}
