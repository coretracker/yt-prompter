"use client";

import { ConfigProvider, theme } from "antd";
import { ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ConfigProvider
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          colorPrimary: "#1677ff",
          borderRadius: 12,
          fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
        },
      }}
    >
      {children}
    </ConfigProvider>
  );
}
