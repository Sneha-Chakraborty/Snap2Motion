import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Snap2Motion — Image to Video Agent",
  description: "Upload an image, describe the scene, pick camera motion, and generate a short video.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="min-h-screen">
          <header className="border-b border-neutral-800">
            <div className="mx-auto max-w-5xl px-4 py-4 flex items-center justify-between">
              <div className="font-semibold tracking-tight">Snap2Motion</div>
              <div className="text-xs text-neutral-400">Image → Video Agent</div>
            </div>
          </header>
          <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
          <footer className="border-t border-neutral-800">
            <div className="mx-auto max-w-5xl px-4 py-6 text-xs text-neutral-500">
              Built for internship assignment • Replicate-powered
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
