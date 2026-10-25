import { Suspense } from "react";
import type { Metadata } from "next";
import { ChatSkeleton, ChatView } from "@/features/chat/chat-view";
export const metadata: Metadata = { title: "Chat" };
async function Thread({ params }: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await params;
  return <ChatView key={threadId} threadId={threadId} />;
}

export default function ThreadPage(props: {
  params: Promise<{ threadId: string }>;
}) {
  return (
    <Suspense fallback={<ChatSkeleton />}>
      <Thread {...props} />
    </Suspense>
  );
}
