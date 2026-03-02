/**
 * Meeting Summary View Component
 *
 * Displays the AI-generated meeting summary as formatted markdown.
 */

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { FileText, Copy, Check, Clock } from 'lucide-react';
import { useCopilotStore } from '../../stores/copilot.store';
import { cn } from '../../lib/utils';
import type { CopilotCallSummary } from '../../../shared/types/ipc.types';

interface CallSummaryViewProps {
  className?: string;
  summary?: CopilotCallSummary;
  duration?: number;
}

export function CallSummaryView({ className, summary: propSummary, duration: propDuration }: CallSummaryViewProps) {
  const store = useCopilotStore();
  const summary = propSummary || store.callSummary;
  const duration = propDuration || store.callDuration;
  const [copied, setCopied] = useState(false);

  if (!summary) {
    return (
      <Card className={cn("", className)}>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Meeting Summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-center py-8">
            Meeting summary will appear here after the recording ends
          </p>
        </CardContent>
      </Card>
    );
  }

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    if (mins === 0) return `${secs}s`;
    return `${mins}m ${secs}s`;
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(summary.summary);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card className={cn("", className)}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Meeting Summary
          </CardTitle>
          <div className="flex items-center gap-2">
            {duration > 0 && (
              <Badge variant="outline" className="text-xs flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {formatDuration(duration)}
              </Badge>
            )}
            <Button variant="outline" size="sm" onClick={copyToClipboard}>
              {copied ? (
                <>
                  <Check className="h-3 w-3 mr-1" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3 mr-1" />
                  Copy
                </>
              )}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <div className="prose prose-sm dark:prose-invert max-w-none">
          <ReactMarkdown
            components={{
              h2: ({ children }) => (
                <h2 className="text-base font-semibold mt-4 mb-2 first:mt-0 border-b pb-1">{children}</h2>
              ),
              h3: ({ children }) => (
                <h3 className="text-sm font-semibold mt-3 mb-1">{children}</h3>
              ),
              ul: ({ children }) => (
                <ul className="list-disc list-inside space-y-1 my-2 ml-2">{children}</ul>
              ),
              ol: ({ children }) => (
                <ol className="list-decimal list-inside space-y-1 my-2 ml-2">{children}</ol>
              ),
              li: ({ children }) => (
                <li className="text-sm">{children}</li>
              ),
              p: ({ children }) => (
                <p className="text-sm my-2 leading-relaxed">{children}</p>
              ),
              // Style checkboxes in action items
              input: ({ type, checked }) => {
                if (type === 'checkbox') {
                  return (
                    <input
                      type="checkbox"
                      checked={checked}
                      readOnly
                      className="mr-2 rounded border-gray-300"
                    />
                  );
                }
                return null;
              },
              strong: ({ children }) => (
                <strong className="font-semibold">{children}</strong>
              ),
            }}
          >
            {summary.summary}
          </ReactMarkdown>
        </div>
      </CardContent>
    </Card>
  );
}

export default CallSummaryView;
