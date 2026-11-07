import type { Metadata } from "next";
import { ChatView } from "@/features/chat/chat-view";
export const metadata: Metadata = { title: "Chat" };
export default function ChatPage() {
  return <ChatView />;
}
