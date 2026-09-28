import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "숏츠디렉터 — 영상 + 한 줄이면 CF 스타일 숏츠 완성",
  description:
    "영상과 한 줄만 넣으면 AI가 편집을 기획하고 자막·모션·CTA를 얹어 세로형 숏츠를 만들어 줍니다.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="text-white antialiased">{children}</body>
    </html>
  );
}
