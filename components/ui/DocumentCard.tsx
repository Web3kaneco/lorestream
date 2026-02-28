'use client';

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { atomDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

interface DocumentCardProps {
  title: string;
  content: string;
  language: string;
  description?: string;
  index: number;
}

export function DocumentCard({ title, content, language, description, index }: DocumentCardProps) {
  const [copied, setCopied] = useState(false);
  const isMarkdown = language === 'markdown' || language === 'text';

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      console.warn('[DocumentCard] Clipboard write failed');
    }
  };

  const handleDownload = () => {
    const extMap: Record<string, string> = {
      javascript: 'js', typescript: 'ts', python: 'py', markdown: 'md', text: 'txt',
      html: 'html', css: 'css', json: 'json', yaml: 'yml', rust: 'rs', go: 'go',
    };
    const ext = extMap[language] || language;
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.replace(/\s+/g, '_').toLowerCase()}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="rounded-xl overflow-hidden border border-[#1a1a1a] bg-[#0a0a0a] shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[#1a1a1a] bg-[#050505]">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-white/40 tracking-widest uppercase">
            Vault Doc #{index + 1}
          </span>
          <span className="text-[10px] px-2 py-0.5 rounded bg-[#d4af37]/15 text-[#d4af37] border border-[#d4af37]/30 font-mono">
            {language}
          </span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleCopy}
            className="text-xs px-2 py-1 rounded hover:bg-white/10 text-white/40 hover:text-white/70 transition-colors"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
          <button
            onClick={handleDownload}
            className="text-xs px-3 py-1 rounded font-bold transition-colors"
            style={{ backgroundColor: '#d4af37', color: '#000' }}
          >
            Export
          </button>
        </div>
      </div>

      {/* Title */}
      <div className="px-4 py-2 border-b border-[#1a1a1a]/50">
        <h3 className="text-sm font-bold text-white">{title}</h3>
        {description && <p className="text-xs text-white/30 mt-1">{description}</p>}
      </div>

      {/* Content */}
      <div className="max-h-80 overflow-y-auto">
        {isMarkdown ? (
          <div className="prose prose-invert prose-sm max-w-none p-4 text-white/80">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </div>
        ) : (
          <SyntaxHighlighter
            language={language}
            style={atomDark}
            customStyle={{ margin: 0, borderRadius: 0, background: '#0a0a0a', fontSize: '0.8rem' }}
            showLineNumbers
          >
            {content}
          </SyntaxHighlighter>
        )}
      </div>
    </div>
  );
}
