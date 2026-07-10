import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Onni · 韩语学习助手",
  description: "基于 AI 的沉浸式韩语学习产品",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh">
      <body>{children}</body>
    </html>
  );
}
