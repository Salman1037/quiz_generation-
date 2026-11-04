"use client";
import type { ReactNode } from "react";
import { MotionConfig } from "framer-motion";
import { WorkspaceProvider } from "@/lib/client/workspace";
import { ExamProvider } from "@/lib/client/exam-store";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <WorkspaceProvider>
        <ExamProvider>{children}</ExamProvider>
      </WorkspaceProvider>
    </MotionConfig>
  );
}
