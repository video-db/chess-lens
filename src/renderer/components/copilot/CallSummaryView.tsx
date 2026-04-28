/**
 * Session Summary View Component
 *
 * Displays the post-meeting summary with:
 * - Short Overview (narrative paragraph)
 * - Key Discussion Points (grouped by topic)
 */

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { FileText, Copy, Check, Clock, ChevronDown, ChevronUp } from 'lucide-react';
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
  const [expandedTopics, setExpandedTopics] = useState<Set<number>>(new Set([0])); // First topic expanded by default

  if (!summary) {
    return (
      <Card className={cn("", className)}>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Session Summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-center py-8">
            Session summary will appear here after the recording ends
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
    // Format summary for clipboard
    let text = `Session Overview\n${'='.repeat(50)}\n${summary.shortOverview}\n\n`;

    if (summary.keyPoints && summary.keyPoints.length > 0) {
      text += `Key Points\n${'='.repeat(50)}\n`;
      summary.keyPoints.forEach((kp) => {
        text += `\n${kp.topic}\n${'-'.repeat(30)}\n`;
        kp.points.forEach((point) => {
          text += `  - ${point}\n`;
        });
      });
    }

    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const toggleTopic = (index: number) => {
    setExpandedTopics((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(index)) {
        newSet.delete(index);
      } else {
        newSet.add(index);
      }
      return newSet;
    });
  };

  return (
    <Card className={cn("", className)}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Session Summary
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

      <CardContent className="space-y-6">
        {/* Short Overview */}
        <div>
          <h3 className="text-sm font-semibold text-foreground mb-2">Overview</h3>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {summary.shortOverview}
          </p>
        </div>

        {/* Key Points */}
        {summary.keyPoints && summary.keyPoints.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3">Key Points</h3>
            <div className="space-y-2">
              {summary.keyPoints.map((kp, idx) => (
                <div key={idx} className="border rounded-lg overflow-hidden">
                  <button
                    className="w-full flex items-center justify-between p-3 hover:bg-muted/50 transition-colors text-left"
                    onClick={() => toggleTopic(idx)}
                  >
                    <span className="font-medium text-sm">{kp.topic}</span>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="text-xs">
                        {kp.points.length} points
                      </Badge>
                      {expandedTopics.has(idx) ? (
                        <ChevronUp className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                  </button>
                  {expandedTopics.has(idx) && (
                    <div className="px-3 pb-3">
                      <ul className="space-y-1.5">
                        {kp.points.map((point, pointIdx) => (
                          <li key={pointIdx} className="flex items-start gap-2 text-sm text-muted-foreground">
                            <span className="text-muted-foreground/60 mt-1.5 text-[8px]">&#9679;</span>
                            <span>{point}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default CallSummaryView;
