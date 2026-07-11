import { eq } from 'drizzle-orm';
import type { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';
import { logger } from '../lib/logger';

type DatabaseClient = ReturnType<typeof drizzle<typeof schema>>;

export function seedDefaultCueCards(database: DatabaseClient) {
  const existing = database
    .select()
    .from(schema.cueCards)
    .where(eq(schema.cueCards.isDefault, true))
    .get();

  if (existing) return;

  const defaultCueCards: schema.NewCueCard[] = [
    {
      id: 'cue-pricing-default',
      objectionType: 'pricing',
      title: 'Handling Pricing Objections',
      talkTracks: JSON.stringify([
        "I understand budget is a concern. Let's talk about the ROI you'd see.",
        "What would the cost of NOT solving this problem be?",
        "Many customers initially had the same concern, but found the value exceeded expectations.",
        "Let's break down the investment relative to the results you'd achieve."
      ]),
      followUpQuestions: JSON.stringify([
        "What budget range were you expecting?",
        "How do you typically evaluate ROI on tools like this?",
        "What's the cost of your current approach?"
      ]),
      proofPoints: JSON.stringify([
        "Average customer sees 3x ROI within 6 months",
        "Reduces manual work by 40%"
      ]),
      avoidSaying: JSON.stringify([
        "I can give you a discount",
        "It's not that expensive"
      ]),
      isDefault: true,
    },
    {
      id: 'cue-timing-default',
      objectionType: 'timing',
      title: 'Handling Timing Objections',
      talkTracks: JSON.stringify([
        "I hear that timing is a factor. What would need to change for this to become a priority?",
        "What's happening next quarter that makes it better timing?",
        "Many customers felt the same, but found that starting now gave them a head start.",
        "Let's identify what a pilot might look like to build confidence."
      ]),
      followUpQuestions: JSON.stringify([
        "What other initiatives are competing for attention?",
        "Who else would need to be involved in this decision?",
        "What would make this urgent?"
      ]),
      isDefault: true,
    },
    {
      id: 'cue-competitor-default',
      objectionType: 'competitor',
      title: 'Handling Competitor Mentions',
      talkTracks: JSON.stringify([
        "That's a solid option. What specifically drew you to them?",
        "We often see customers compare us. Here's where we differentiate...",
        "What criteria are most important in your evaluation?",
        "Happy to do a side-by-side comparison on the areas that matter most to you."
      ]),
      followUpQuestions: JSON.stringify([
        "What's working well with your current solution?",
        "What gaps are you hoping to fill?",
        "Are you actively evaluating alternatives?"
      ]),
      isDefault: true,
    },
    {
      id: 'cue-authority-default',
      objectionType: 'authority',
      title: 'Handling Authority Objections',
      talkTracks: JSON.stringify([
        "Totally understand. Who else would be involved in this decision?",
        "What would they need to see to feel confident?",
        "Would it help if I prepared materials for your internal discussion?",
        "Let's make sure we address their concerns proactively."
      ]),
      followUpQuestions: JSON.stringify([
        "What's your typical buying process?",
        "Who signs off on purchases like this?",
        "Would a meeting with all stakeholders be helpful?"
      ]),
      isDefault: true,
    },
    {
      id: 'cue-security-default',
      objectionType: 'security',
      title: 'Handling Security Concerns',
      talkTracks: JSON.stringify([
        "Security is critical. Here's how we approach it...",
        "We're SOC 2 Type II certified and GDPR compliant.",
        "I can connect you with our security team for a detailed review.",
        "What specific security requirements do you have?"
      ]),
      followUpQuestions: JSON.stringify([
        "What compliance frameworks do you need to meet?",
        "Who handles security reviews on your side?",
        "Would you like to see our security documentation?"
      ]),
      isDefault: true,
    },
    {
      id: 'cue-integration-default',
      objectionType: 'integration',
      title: 'Handling Integration Questions',
      talkTracks: JSON.stringify([
        "Great question on integrations. We connect with...",
        "Our API is well-documented and our team can support custom integrations.",
        "What systems would this need to work with?",
        "Let me show you how other customers have integrated."
      ]),
      followUpQuestions: JSON.stringify([
        "What's your current tech stack?",
        "What data would need to flow between systems?",
        "Do you have internal resources for integrations?"
      ]),
      isDefault: true,
    },
  ];

  for (const card of defaultCueCards) {
    database.insert(schema.cueCards).values(card).run();
  }

  logger.info('Seeded default cue cards');
}

export function seedDefaultPlaybooks(database: DatabaseClient) {
  const existing = database
    .select()
    .from(schema.playbooks)
    .where(eq(schema.playbooks.id, 'template-1on1'))
    .get();

  if (existing) return;

  // 1:1 Check-in Template
  const oneOnOneTemplate: schema.NewPlaybook = {
    id: 'template-1on1',
    name: '1:1 Check-in',
    type: 'Custom',
    description: 'A structured template for one-on-one meetings covering updates, goals, blockers, and feedback.',
    items: JSON.stringify([
      {
        id: 'updates',
        label: 'Updates & Progress',
        description: 'Review recent progress and accomplishments',
        keywords: ['update', 'progress', 'completed', 'finished', 'done', 'accomplished', 'shipped'],
        suggestedQuestions: [
          'What have you been working on since we last met?',
          'What are you most proud of recently?',
          'Any wins you want to share?'
        ],
        detectionPrompt: 'Were updates or recent progress discussed?',
        status: 'missing',
        evidence: []
      },
      {
        id: 'goals',
        label: 'Goals & Priorities',
        description: 'Discuss current and upcoming priorities',
        keywords: ['goal', 'priority', 'focus', 'objective', 'target', 'plan', 'next'],
        suggestedQuestions: [
          'What are your top priorities for the coming week?',
          'Are your current goals still relevant?',
          'What do you want to accomplish by our next meeting?'
        ],
        detectionPrompt: 'Were goals or priorities discussed?',
        status: 'missing',
        evidence: []
      },
      {
        id: 'blockers',
        label: 'Blockers & Challenges',
        description: 'Identify obstacles and how to resolve them',
        keywords: ['blocker', 'challenge', 'stuck', 'problem', 'issue', 'help', 'support', 'difficulty'],
        suggestedQuestions: [
          'What\'s blocking your progress?',
          'Where do you need help or support?',
          'Any challenges I can help with?'
        ],
        detectionPrompt: 'Were blockers or challenges discussed?',
        status: 'missing',
        evidence: []
      },
      {
        id: 'feedback',
        label: 'Feedback & Development',
        description: 'Exchange feedback and discuss growth',
        keywords: ['feedback', 'improve', 'grow', 'learn', 'development', 'coaching', 'suggestion'],
        suggestedQuestions: [
          'Is there any feedback you\'d like to share?',
          'What skills would you like to develop?',
          'How can I better support you?'
        ],
        detectionPrompt: 'Was feedback or development discussed?',
        status: 'missing',
        evidence: []
      }
    ]),
    isDefault: true,
  };

  database.insert(schema.playbooks).values(oneOnOneTemplate).run();

  // Project Review Template
  const projectReviewTemplate: schema.NewPlaybook = {
    id: 'template-project-review',
    name: 'Project Review',
    type: 'Custom',
    description: 'A template for project status meetings covering progress, risks, decisions, and next steps.',
    items: JSON.stringify([
      {
        id: 'status',
        label: 'Status Overview',
        description: 'Review overall project status and timeline',
        keywords: ['status', 'timeline', 'schedule', 'on track', 'behind', 'ahead', 'milestone'],
        suggestedQuestions: [
          'What\'s the overall project status?',
          'Are we on track with the timeline?',
          'Any milestones coming up?'
        ],
        detectionPrompt: 'Was the project status or timeline discussed?',
        status: 'missing',
        evidence: []
      },
      {
        id: 'risks',
        label: 'Risks & Issues',
        description: 'Identify and discuss project risks',
        keywords: ['risk', 'issue', 'concern', 'problem', 'blocker', 'delay', 'impact'],
        suggestedQuestions: [
          'What risks should we be aware of?',
          'Any issues that need escalation?',
          'What could derail the project?'
        ],
        detectionPrompt: 'Were project risks or issues discussed?',
        status: 'missing',
        evidence: []
      },
      {
        id: 'decisions',
        label: 'Decisions Needed',
        description: 'Identify decisions that need to be made',
        keywords: ['decide', 'decision', 'choose', 'option', 'approve', 'agree', 'consensus'],
        suggestedQuestions: [
          'What decisions do we need to make?',
          'Who needs to be involved in this decision?',
          'What are our options?'
        ],
        detectionPrompt: 'Were decisions discussed or made?',
        status: 'missing',
        evidence: []
      },
      {
        id: 'next-steps',
        label: 'Next Steps',
        description: 'Define action items and next steps',
        keywords: ['next', 'action', 'step', 'task', 'owner', 'deadline', 'follow up'],
        suggestedQuestions: [
          'What are the next steps?',
          'Who owns each action item?',
          'When do we need this completed?'
        ],
        detectionPrompt: 'Were next steps or action items defined?',
        status: 'missing',
        evidence: []
      }
    ]),
    isDefault: false,
  };

  database.insert(schema.playbooks).values(projectReviewTemplate).run();

  // Retrospective Template
  const retroTemplate: schema.NewPlaybook = {
    id: 'template-retrospective',
    name: 'Retrospective',
    type: 'Custom',
    description: 'A template for team retrospectives covering what went well, what could improve, and action items.',
    items: JSON.stringify([
      {
        id: 'went-well',
        label: 'What Went Well',
        description: 'Celebrate successes and positive outcomes',
        keywords: ['well', 'good', 'great', 'success', 'win', 'proud', 'worked', 'positive'],
        suggestedQuestions: [
          'What went well this sprint/period?',
          'What should we keep doing?',
          'What are we proud of?'
        ],
        detectionPrompt: 'Were positive outcomes or successes discussed?',
        status: 'missing',
        evidence: []
      },
      {
        id: 'improve',
        label: 'What Could Improve',
        description: 'Identify areas for improvement',
        keywords: ['improve', 'better', 'challenge', 'difficult', 'issue', 'problem', 'frustrating'],
        suggestedQuestions: [
          'What could we do better?',
          'What was frustrating or challenging?',
          'What should we stop doing?'
        ],
        detectionPrompt: 'Were improvement areas or challenges discussed?',
        status: 'missing',
        evidence: []
      },
      {
        id: 'actions',
        label: 'Action Items',
        description: 'Define concrete actions to take',
        keywords: ['action', 'do', 'change', 'try', 'experiment', 'implement', 'commit'],
        suggestedQuestions: [
          'What specific actions will we take?',
          'Who will own each action?',
          'How will we measure success?'
        ],
        detectionPrompt: 'Were action items or commitments defined?',
        status: 'missing',
        evidence: []
      }
    ]),
    isDefault: false,
  };

  database.insert(schema.playbooks).values(retroTemplate).run();

  // Discovery/Requirements Template
  const discoveryTemplate: schema.NewPlaybook = {
    id: 'template-discovery',
    name: 'Discovery / Requirements',
    type: 'Custom',
    description: 'A template for discovery and requirements gathering meetings.',
    items: JSON.stringify([
      {
        id: 'context',
        label: 'Context & Background',
        description: 'Understand the situation and context',
        keywords: ['context', 'background', 'situation', 'currently', 'today', 'existing', 'history'],
        suggestedQuestions: [
          'Can you give me some background on this?',
          'What\'s the current situation?',
          'How did we get here?'
        ],
        detectionPrompt: 'Was context or background discussed?',
        status: 'missing',
        evidence: []
      },
      {
        id: 'goals',
        label: 'Goals & Outcomes',
        description: 'Define desired outcomes and success criteria',
        keywords: ['goal', 'outcome', 'success', 'achieve', 'want', 'need', 'result', 'objective'],
        suggestedQuestions: [
          'What are you trying to achieve?',
          'What does success look like?',
          'What are your must-have outcomes?'
        ],
        detectionPrompt: 'Were goals or desired outcomes discussed?',
        status: 'missing',
        evidence: []
      },
      {
        id: 'requirements',
        label: 'Requirements & Constraints',
        description: 'Gather specific requirements and constraints',
        keywords: ['requirement', 'need', 'must', 'constraint', 'limitation', 'budget', 'timeline'],
        suggestedQuestions: [
          'What are the key requirements?',
          'What constraints do we have?',
          'What\'s the timeline and budget?'
        ],
        detectionPrompt: 'Were requirements or constraints discussed?',
        status: 'missing',
        evidence: []
      },
      {
        id: 'stakeholders',
        label: 'Stakeholders',
        description: 'Identify key stakeholders and decision makers',
        keywords: ['stakeholder', 'team', 'involved', 'decision', 'approval', 'owner', 'responsible'],
        suggestedQuestions: [
          'Who are the key stakeholders?',
          'Who needs to be involved in decisions?',
          'Who will be impacted by this?'
        ],
        detectionPrompt: 'Were stakeholders or decision makers identified?',
        status: 'missing',
        evidence: []
      }
    ]),
    isDefault: false,
  };

  database.insert(schema.playbooks).values(discoveryTemplate).run();

  // Interview Template
  const interviewTemplate: schema.NewPlaybook = {
    id: 'template-interview',
    name: 'Interview',
    type: 'Custom',
    description: 'A template for conducting structured interviews (hiring, user research, etc.).',
    items: JSON.stringify([
      {
        id: 'intro',
        label: 'Introduction & Context',
        description: 'Set the stage and build rapport',
        keywords: ['introduce', 'background', 'tell me about', 'yourself', 'role', 'experience'],
        suggestedQuestions: [
          'Tell me about yourself',
          'What brings you here today?',
          'Can you walk me through your background?'
        ],
        detectionPrompt: 'Was there an introduction or context setting?',
        status: 'missing',
        evidence: []
      },
      {
        id: 'core-questions',
        label: 'Core Questions',
        description: 'Cover the main interview topics',
        keywords: ['example', 'time when', 'describe', 'how did you', 'tell me about', 'situation'],
        suggestedQuestions: [
          'Can you give me an example of...?',
          'Tell me about a time when...',
          'How did you handle...?'
        ],
        detectionPrompt: 'Were core interview questions covered?',
        status: 'missing',
        evidence: []
      },
      {
        id: 'deep-dive',
        label: 'Follow-up & Deep Dive',
        description: 'Explore responses in more detail',
        keywords: ['why', 'how', 'what happened', 'result', 'learn', 'differently', 'outcome'],
        suggestedQuestions: [
          'Why did you approach it that way?',
          'What was the result?',
          'What would you do differently?'
        ],
        detectionPrompt: 'Were follow-up questions asked to go deeper?',
        status: 'missing',
        evidence: []
      },
      {
        id: 'questions',
        label: 'Candidate Questions',
        description: 'Allow time for their questions',
        keywords: ['question', 'ask', 'wonder', 'curious', 'want to know', 'anything else'],
        suggestedQuestions: [
          'What questions do you have for me?',
          'Is there anything you\'d like to know?',
          'What else would be helpful to understand?'
        ],
        detectionPrompt: 'Was time given for their questions?',
        status: 'missing',
        evidence: []
      }
    ]),
    isDefault: false,
  };

  database.insert(schema.playbooks).values(interviewTemplate).run();

  // Brainstorm Template
  const brainstormTemplate: schema.NewPlaybook = {
    id: 'template-brainstorm',
    name: 'Brainstorm / Ideation',
    type: 'Custom',
    description: 'A template for brainstorming and ideation sessions.',
    items: JSON.stringify([
      {
        id: 'problem',
        label: 'Problem Definition',
        description: 'Clearly define the problem to solve',
        keywords: ['problem', 'challenge', 'solve', 'issue', 'opportunity', 'goal', 'trying to'],
        suggestedQuestions: [
          'What problem are we trying to solve?',
          'Why is this important?',
          'What does success look like?'
        ],
        detectionPrompt: 'Was the problem clearly defined?',
        status: 'missing',
        evidence: []
      },
      {
        id: 'ideas',
        label: 'Idea Generation',
        description: 'Generate and capture ideas',
        keywords: ['idea', 'what if', 'could we', 'maybe', 'option', 'possibility', 'try'],
        suggestedQuestions: [
          'What ideas do we have?',
          'What if we tried...?',
          'What other options are there?'
        ],
        detectionPrompt: 'Were ideas generated and discussed?',
        status: 'missing',
        evidence: []
      },
      {
        id: 'evaluation',
        label: 'Evaluation & Prioritization',
        description: 'Evaluate and prioritize ideas',
        keywords: ['prioritize', 'best', 'feasible', 'impact', 'effort', 'vote', 'rank', 'evaluate'],
        suggestedQuestions: [
          'Which ideas have the most potential?',
          'What\'s feasible given our constraints?',
          'How should we prioritize?'
        ],
        detectionPrompt: 'Were ideas evaluated or prioritized?',
        status: 'missing',
        evidence: []
      },
      {
        id: 'next-steps',
        label: 'Next Steps',
        description: 'Define actions to move forward',
        keywords: ['next', 'action', 'do', 'try', 'prototype', 'test', 'follow up'],
        suggestedQuestions: [
          'What are our next steps?',
          'Who will take this forward?',
          'When will we reconvene?'
        ],
        detectionPrompt: 'Were next steps defined?',
        status: 'missing',
        evidence: []
      }
    ]),
    isDefault: false,
  };

  database.insert(schema.playbooks).values(brainstormTemplate).run();

  logger.info('Seeded default meeting templates');
}

export function seedDefaultSettings(database: DatabaseClient) {
  const existing = database
    .select()
    .from(schema.copilotSettings)
    .get();

  if (existing) return;

  const defaultSettings: schema.NewCopilotSetting[] = [
    {
      key: 'prompt_sentiment_analysis',
      category: 'prompt',
      label: 'Sentiment Analysis Prompt',
      description: 'Prompt used to analyze participant sentiment when pattern matching is inconclusive',
      value: `Analyze the sentiment of this participant statement in a meeting context.
Return ONLY one word: "positive", "neutral", or "negative"

Statement: "{text}"

Sentiment:`,
    },
    {
      key: 'prompt_objection_detection',
      category: 'prompt',
      label: 'Objection Detection Prompt',
      description: 'Prompt used to detect objections in participant speech',
      value: `Analyze this participant statement from a meeting for objections.

Statement: "{text}"

Identify if this contains an objection. If yes, classify it as one of:
- pricing (cost, budget, expensive)
- timing (not now, later, next quarter)
- competitor (using another solution)
- authority (need approval, decision maker)
- security (data, compliance, privacy)
- integration (technical fit, compatibility)
- not_interested (no need, not a priority)
- send_info (just send materials)

Return JSON: {"hasObjection": boolean, "type": string or null, "confidence": 0-1}`,
    },
    {
      key: 'prompt_summary_bullets',
      category: 'prompt',
      label: 'Summary Bullets Prompt',
      description: 'Prompt used to generate meeting summary bullet points',
      value: `Analyze this meeting transcript and extract 3-5 key summary bullets.
Focus on main discussion points, decisions, and outcomes.

Transcript:
{transcript}

Return JSON array of strings: ["bullet1", "bullet2", ...]`,
    },
    {
      key: 'prompt_pain_points',
      category: 'prompt',
      label: 'Pain Points Extraction Prompt',
      description: 'Prompt used to extract pain points from the meeting',
      value: `Analyze this meeting transcript and identify participant pain points.
Look for problems, challenges, frustrations, and inefficiencies mentioned.

Transcript:
{transcript}

Return JSON array of strings: ["pain1", "pain2", ...]`,
    },
    {
      key: 'prompt_next_steps',
      category: 'prompt',
      label: 'Next Steps Extraction Prompt',
      description: 'Prompt used to extract action items and next steps',
      value: `Analyze this meeting transcript and identify all action items and next steps.
For each, identify who is responsible (me=you, them=other participant, both).

Transcript:
{transcript}

Return JSON array: [{"action": "string", "owner": "me"|"them"|"both", "priority": "high"|"medium"|"low"}]`,
    },
    {
      key: 'threshold_monologue_seconds',
      category: 'threshold',
      label: 'Monologue Alert Threshold',
      description: 'Seconds of continuous talking before triggering a monologue nudge',
      value: '60',
    },
    {
      key: 'threshold_talk_ratio_max',
      category: 'threshold',
      label: 'Max Talk Ratio',
      description: 'Maximum percentage you should be talking (triggers nudge if exceeded)',
      value: '70',
    },
    {
      key: 'threshold_pace_max_wpm',
      category: 'threshold',
      label: 'Max Speaking Pace',
      description: 'Maximum words per minute before pace nudge (typical conversation is 120-150)',
      value: '180',
    },
    {
      key: 'threshold_nudge_cooldown_ms',
      category: 'threshold',
      label: 'Nudge Cooldown',
      description: 'Minimum milliseconds between nudges',
      value: '120000',
    },
    {
      key: 'config_llm_detection',
      category: 'config',
      label: 'Use LLM for Detection',
      description: 'Use AI for objection/sentiment detection (more accurate but slower)',
      value: 'true',
    },
    {
      key: 'config_auto_bookmark_objections',
      category: 'config',
      label: 'Auto-Bookmark Objections',
      description: 'Automatically create bookmarks when objections are detected',
      value: 'true',
    },
  ];

  for (const setting of defaultSettings) {
    database.insert(schema.copilotSettings).values(setting).run();
  }

  logger.info('Seeded default copilot settings');
}
