import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ShortsDirector — footage + a brief → a movie-CF short",
  description:
    "Upload your clips and one line. AI plans the edit, adds captions, motion and a CTA, and renders a vertical short.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="text-white antialiased">{children}</body>
    </html>
  );
}
