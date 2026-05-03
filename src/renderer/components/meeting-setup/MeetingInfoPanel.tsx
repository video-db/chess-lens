import React from 'react';
import { FileText, MessageSquareText, CheckSquare, ChevronDown, ChevronUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { useGameSetupStore } from '../../stores/meeting-setup.store';
import { cn } from '../../lib/utils';

export function MeetingInfoPanel() {
  const { name, description, questions, checklist } = useGameSetupStore();
  const [expandedSections, setExpandedSections] = React.useState({
    questions: false,
    checklist: true,
  });

  const toggleSection = (section: 'questions' | 'checklist') => {
    setExpandedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  if (!name) {
    return null;
  }

  return (
    <div className="space-y-4 h-full overflow-auto pr-1">
      {/* Game Info Card */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            <CardTitle className="text-sm">Game</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <h3 className="font-semibold">{name}</h3>
          <p className="text-sm text-muted-foreground line-clamp-3">{description}</p>
        </CardContent>
      </Card>

      {/* Probing Q&A Card */}
      {questions.length > 0 && (
        <Card>
          <CardHeader
            className="pb-2 cursor-pointer hover:bg-muted/50 transition-colors rounded-t-lg"
            onClick={() => toggleSection('questions')}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MessageSquareText className="h-4 w-4 text-primary" />
                <CardTitle className="text-sm">Context</CardTitle>
                <Badge variant="secondary" className="text-xs">
                  {questions.length}
                </Badge>
              </div>
              {expandedSections.questions ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
          </CardHeader>
          {expandedSections.questions && (
            <CardContent className="space-y-4 animate-in slide-in-from-top-2 duration-200">
              {questions.map((q, idx) => (
                <div key={idx} className="space-y-1">
                  <p className="text-xs text-muted-foreground">{q.question}</p>
                  <p className="text-sm font-medium">
                    {q.answer}
                    {q.customAnswer && (
                      <span className="text-muted-foreground"> + {q.customAnswer}</span>
                    )}
                  </p>
                </div>
              ))}
            </CardContent>
          )}
        </Card>
      )}

      {/* Checklist Card */}
      {checklist.length > 0 && (
        <Card>
          <CardHeader
            className="pb-2 cursor-pointer hover:bg-muted/50 transition-colors rounded-t-lg"
            onClick={() => toggleSection('checklist')}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckSquare className="h-4 w-4 text-primary" />
                <CardTitle className="text-sm">Checklist</CardTitle>
                <Badge variant="secondary" className="text-xs">
                  {checklist.length}
                </Badge>
              </div>
              {expandedSections.checklist ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
          </CardHeader>
          {expandedSections.checklist && (
            <CardContent className="animate-in slide-in-from-top-2 duration-200">
              <ul className="space-y-2">
                {checklist.map((item, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <div className="w-4 h-4 rounded border border-muted-foreground/40 flex-shrink-0 mt-0.5" />
                    <span className="text-sm">{item}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          )}
        </Card>
      )}
    </div>
  );
}
