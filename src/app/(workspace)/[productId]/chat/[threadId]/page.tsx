import type { Metadata } from "next";
import { ChatView } from "@/features/chat/chat-view";
export const metadata: Metadata = { title: "Chat" };
export default async function ThreadPage({
  params,
}: {
  params: Promise<{ threadId: string }>;
}) {
  const { threadId } = await params;
  return <ChatView key={threadId} threadId={threadId} />;
}
