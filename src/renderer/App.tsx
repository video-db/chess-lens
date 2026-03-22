import { useState } from 'react';
import { Sidebar } from './components/layout/Sidebar';
import { MainContent } from './components/layout/MainContent';
import { AuthView } from './components/auth/AuthView';
import { StreamToggles } from './components/recording/StreamToggles';
import { TopStatusBar } from './components/recording/TopStatusBar';
import { TranscriptionPanel } from './components/transcription/TranscriptionPanel';
import { HistoryView } from './components/history/HistoryView';
import { useConfigStore } from './stores/config.store';
import { useSession } from './hooks/useSession';
import { useSessionStore } from './stores/session.store';
import { usePermissions } from './hooks/usePermissions';
import { useGlobalRecorderEvents } from './hooks/useGlobalRecorderEvents';
import { useCopilot } from './hooks/useCopilot';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './components/ui/card';
import { Button } from './components/ui/button';
import { Badge } from './components/ui/badge';
import { ErrorToast } from './components/ui/error-toast';
import { AlertCircle, Shield, Loader2 } from 'lucide-react';
import {
  NudgeToast,
  CallSummaryView,
} from './components/copilot';
import { MCPResultsOverlay } from './components/mcp';
import { useCopilotStore } from './stores/copilot.store';
import { MCPServersPanel } from './components/settings/MCPServersPanel';

type Tab = 'recording' | 'history' | 'settings';

function PermissionsView() {
  const { status, requestMicPermission, openSettings } = usePermissions();

  return (
    <div className="max-w-md mx-auto mt-20">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <CardTitle>Permissions Required</CardTitle>
          </div>
          <CardDescription>
            Meeting Copilot needs access to record your screen and microphone.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-3 rounded-lg border">
            <div>
              <p className="font-medium text-sm">Microphone</p>
              <p className="text-xs text-muted-foreground">Required for voice recording</p>
            </div>
            {status.microphone ? (
              <span className="text-xs text-green-600 font-medium">Granted</span>
            ) : (
              <Button size="sm" onClick={requestMicPermission}>
                Grant
              </Button>
            )}
          </div>

          <div className="flex items-center justify-between p-3 rounded-lg border">
            <div>
              <p className="font-medium text-sm">Screen Recording</p>
              <p className="text-xs text-muted-foreground">Required for screen capture</p>
            </div>
            {status.screen ? (
              <span className="text-xs text-green-600 font-medium">Granted</span>
            ) : (
              <Button size="sm" onClick={() => openSettings('screen')}>
                Open Settings
              </Button>
            )}
          </div>

          {!status.screen && (
            <div className="flex items-start gap-2 p-3 bg-muted rounded-lg">
              <AlertCircle className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground">
                Screen Recording permission must be granted in System Preferences. Click "Open
                Settings" and enable Meeting Copilot in the list.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function RecordingView() {
  const { isCallActive, callSummary } = useCopilotStore();
  const { status, streams, toggleStream, isStarting, isStopping } = useSession();

  const isRecording = status === 'recording';
  const isProcessing = status === 'processing' || status === 'stopping';

  useCopilot();

  // Show call summary view if call ended and summary available
  if (callSummary && !isCallActive) {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        <TopStatusBar />
        <div className="flex-1 overflow-hidden p-6">
          <div className="max-w-4xl mx-auto h-full flex flex-col">
            <div className="flex items-center justify-between mb-4 shrink-0">
              <h2 className="text-lg font-semibold">Call Complete</h2>
              <Button variant="outline" size="sm" onClick={() => useCopilotStore.getState().reset()}>
                Start New Call
              </Button>
            </div>
            <div className="flex-1 min-h-0 overflow-auto">
              <CallSummaryView />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Show processing state while generating summary (only after recording stopped)
  if (isProcessing) {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        <TopStatusBar />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-4">
            <div className="w-16 h-16 mx-auto rounded-full bg-primary/10 flex items-center justify-center">
              <Loader2 className="w-8 h-8 text-primary animate-spin" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Generating Call Summary</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Analyzing your conversation and preparing insights...
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
      {/* Top Status Bar */}
      <TopStatusBar />

      {/* Main Content Area */}
      <div className="flex-1 flex gap-4 p-4 overflow-hidden">
        {/* Left Column - Transcription */}
        <div className="flex-1 flex flex-col gap-4 min-w-0">
          {/* Stream Toggles (only show when not recording) */}
          {!isRecording && (
            <Card className="shrink-0">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Recording Sources</CardTitle>
              </CardHeader>
              <CardContent>
                <StreamToggles
                  streams={streams}
                  onToggle={toggleStream}
                  disabled={isStarting || isStopping}
                />
              </CardContent>
            </Card>
          )}

          {/* Transcription Panel */}
          <div className="flex-1 min-h-0">
            <TranscriptionPanel />
          </div>
        </div>

        {/* Right Column - MCP Results */}
        <div className="w-96 flex flex-col gap-4 shrink-0 overflow-hidden">
          <div className="flex-1 overflow-y-auto pr-1">
            {/* MCP Results Overlay - Shows tool call results */}
            <MCPResultsOverlay />
          </div>
        </div>
      </div>

    </div>
  );
}

function SettingsView() {
  const [activeSettingsTab, setActiveSettingsTab] = useState<
    'account' | 'mcpServers'
  >('account');
  const configStore = useConfigStore();

  const settingsTabs = [
    { id: 'account' as const, label: 'Account' },
    { id: 'mcpServers' as const, label: 'MCP Servers' },
  ];

  return (
    <div className="space-y-4 h-full overflow-auto">
      {/* Settings Tabs */}
      <div className="flex gap-1 p-1 bg-muted rounded-lg w-fit">
        {settingsTabs.map((tab) => (
          <Button
            key={tab.id}
            variant={activeSettingsTab === tab.id ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setActiveSettingsTab(tab.id)}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="max-w-4xl">
        {activeSettingsTab === 'account' && (
          <div className="max-w-md space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Account</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div>
                  <p className="text-sm text-muted-foreground">Name</p>
                  <p className="font-medium">{configStore.userName || 'Not set'}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">API Key</p>
                  <p className="font-mono text-xs">
                    {configStore.apiKey ? `${configStore.apiKey.slice(0, 8)}...` : 'Not set'}
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>About</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Meeting Copilot is a desktop app for recording meetings with real-time
                  transcription and AI-powered insights.
                </p>
                <p className="text-xs text-muted-foreground">
                  Built with Electron, React, and VideoDB.
                </p>
              </CardContent>
            </Card>
          </div>
        )}

        {activeSettingsTab === 'mcpServers' && <MCPServersPanel />}
      </div>
    </div>
  );
}

export function App() {
  const [activeTab, setActiveTab] = useState<Tab>('recording');

  const configStore = useConfigStore();
  const sessionStore = useSessionStore();
  const { allGranted, loading: permissionsLoading } = usePermissions();

  // Global listener for recorder events - persists during navigation
  useGlobalRecorderEvents();

  const isAuthenticated = configStore.isAuthenticated();

  // Handle clearing session errors
  const handleDismissError = () => {
    sessionStore.setError(null);
  };

  const getTitle = () => {
    switch (activeTab) {
      case 'recording':
        return 'Recording';
      case 'history':
        return 'History';
      case 'settings':
        return 'Settings';
    }
  };

  const renderContent = () => {
    if (!isAuthenticated) {
      return <AuthView />;
    }

    if (permissionsLoading) {
      return (
        <div className="flex items-center justify-center h-full">
          <p className="text-muted-foreground">Checking permissions...</p>
        </div>
      );
    }

    if (!allGranted && activeTab === 'recording') {
      return <PermissionsView />;
    }

    switch (activeTab) {
      case 'recording':
        return <RecordingView />;
      case 'history':
        return <HistoryView />;
      case 'settings':
        return <SettingsView />;
    }
  };

  // Special layout for recording view - no MainContent header
  if (isAuthenticated && activeTab === 'recording' && allGranted && !permissionsLoading) {
    return (
      <div className="flex flex-col h-screen bg-background">
        {/* Shared titlebar for macOS traffic lights */}
        <div className="h-12 flex items-center justify-center border-b bg-background/80 backdrop-blur-lg shrink-0 drag-region relative">
          {/* Space for traffic lights (absolute so title can center) */}
          <div className="absolute left-0 w-20 shrink-0" />
          <span className="text-sm font-medium text-muted-foreground">Meeting Copilot</span>
        </div>

        {/* Main layout below titlebar */}
        <div className="flex flex-1 overflow-hidden">
          <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />
          <div className="flex-1 overflow-hidden">
            <RecordingView />
          </div>
        </div>

        {/* Global Copilot Components */}
        <NudgeToast position="bottom" />
        <ErrorToast
          message={sessionStore.error}
          onDismiss={handleDismissError}
          position="bottom"
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Shared titlebar for macOS traffic lights */}
      <div className="h-12 flex items-center justify-center border-b bg-background/80 backdrop-blur-lg shrink-0 drag-region relative">
        {/* Space for traffic lights (absolute so title can center) */}
        <div className="absolute left-0 w-20 shrink-0" />
        <span className="text-sm font-medium text-muted-foreground">Meeting Copilot</span>
      </div>

      {/* Main layout below titlebar */}
      <div className="flex flex-1 overflow-hidden">
        {isAuthenticated && <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />}
        <MainContent title={getTitle()}>{renderContent()}</MainContent>
      </div>

      {/* Global Copilot Components */}
      {isAuthenticated && <NudgeToast position="bottom" />}
      <ErrorToast
        message={sessionStore.error}
        onDismiss={handleDismissError}
        position="bottom"
      />
    </div>
  );
}
