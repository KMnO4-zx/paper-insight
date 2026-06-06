from prompt import CHAT_SYSTEM_PROMPT
from markdown_utils import normalize_llm_markdown

class ChatSession:
    def __init__(self, llm, context: str = "", history: list = None):
        self.llm = llm
        self.context = context
        self.history = history or []

    def _build_messages(self):
        messages = [{"role": "system", "content": CHAT_SYSTEM_PROMPT}]
        if self.context:
            messages.append({"role": "user", "content": f"以下是论文相关内容：\n{self.context}"})
            messages.append({"role": "assistant", "content": "好的，我已了解这篇论文的内容，请问有什么问题？"})
        messages.extend(self.history)
        return messages

    async def send(self, user_message: str, **kwargs) -> str:
        self.history.append({"role": "user", "content": user_message})
        reply = await self.llm.chat(self._build_messages(), **kwargs)
        normalized_reply = normalize_llm_markdown(reply)
        self.history.append({"role": "assistant", "content": normalized_reply})
        return normalized_reply

    async def send_stream(self, user_message: str, **kwargs):
        async for stream_chunk in self.send_stream_events(user_message, **kwargs):
            if stream_chunk.kind == "content":
                yield stream_chunk.content

    async def send_stream_events(self, user_message: str, **kwargs):
        self.history.append({"role": "user", "content": user_message})
        chunks = []
        async for stream_chunk in self.llm.chat_stream_events(self._build_messages(), **kwargs):
            if stream_chunk.kind == "content":
                chunks.append(stream_chunk.content)
            yield stream_chunk
        self.history.append({"role": "assistant", "content": normalize_llm_markdown("".join(chunks))})

    def clear(self):
        self.history.clear()
