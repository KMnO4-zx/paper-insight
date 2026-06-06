import { useEffect, useRef, useState } from 'react';
import { Brain, ChevronDown, ChevronRight } from 'lucide-react';

interface ReasoningStreamPanelProps {
  reasoning: string;
  className?: string;
}

export function ReasoningStreamPanel({ reasoning, className = '' }: ReasoningStreamPanelProps) {
  const [isOpen, setIsOpen] = useState(true);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const body = bodyRef.current;
    if (body) {
      body.scrollTop = body.scrollHeight;
    }
  }, [reasoning]);

  if (!reasoning) {
    return null;
  }

  return (
    <div className={`rounded-2xl border border-[#fed7aa] bg-[#fff7ed] px-3 py-2 text-[#9a5600] ${className}`}>
      <button
        type="button"
        className="flex w-full items-center gap-2 text-left text-xs font-semibold"
        onClick={() => setIsOpen((current) => !current)}
      >
        {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <Brain className="h-3.5 w-3.5" />
        <span className="flex-1">模型思考中</span>
      </button>
      {isOpen ? (
        <div
          ref={bodyRef}
          className="mt-2 max-h-20 overflow-y-auto whitespace-pre-wrap break-words rounded-xl bg-white/70 px-3 py-2 text-xs leading-5 text-[#7c4a03]"
        >
          {reasoning}
        </div>
      ) : null}
    </div>
  );
}
