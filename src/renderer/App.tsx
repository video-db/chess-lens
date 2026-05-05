import React, { useState } from 'react';
import { NewSidebar } from './components/layout/NewSidebar';
import { AuthView } from './components/auth/AuthView';
import { HistoryView } from './components/history/HistoryView';
import { useConfigStore } from './stores/config.store';
import { useSession } from './hooks/useSession';
import { useSessionStore } from './stores/session.store';
import { usePermissions } from './hooks/usePermissions';
import { useGlobalRecorderEvents } from './hooks/useGlobalRecorderEvents';
import { ErrorToast } from './components/ui/error-toast';
import { Loader2, AlertTriangle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './components/ui/dialog';
import { NudgeToast } from './components/copilot';
import { useCopilotStore } from './stores/copilot.store';
import { useGameSetupStore } from './stores/meeting-setup.store';
import { useSessionLifecycle } from './hooks/useSessionLifecycle';
import { SettingsView } from './components/settings/SettingsView';
import { MeetingSetupFlow } from './components/meeting-setup';
import { RecordingPreferencesView } from './components/auth/RecordingPreferencesView';
import { PermissionsView } from './components/onboarding/PermissionsView';
import { RecordingView } from './components/recording/RecordingView';

type Tab = 'home' | 'history' | 'settings';

export function App() {
  const [activeTab, setActiveTab] = useState<Tab>('home');
  const [showRecordingPrefs, setShowRecordingPrefs] = useState(false);
  const [showMeetingSetup, setShowMeetingSetup] = useState(false);
  // Recording ID to navigate to after recording ends
  const [pendingRecordingNavigation, setPendingRecordingNavigation] = useState<number | null>(null);
  // Pending tab change when user needs to confirm discarding meeting setup
  const [pendingTabChange, setPendingTabChange] = useState<Tab | null>(null);

  const configStore = useConfigStore();
  const sessionStore = useSessionStore();
  const meetingSetupStore = useGameSetupStore();

  // Check if game setup has any user-entered data
  const hasMeetingSetupData = () => {
    return (
      meetingSetupStore.name.trim().length > 0 ||
      meetingSetupStore.description.trim().length > 0 ||
      meetingSetupStore.questions.length > 0 ||
      meetingSetupStore.checklist.length > 0
    );
  };

  // Handle tab change with game setup check
  const handleTabChange = (tab: Tab) => {
    // If we're in game setup mode and trying to navigate away
    if (showMeetingSetup && activeTab === 'home' && tab !== 'home') {
      if (hasMeetingSetupData()) {
        // Has data - show confirmation
        setPendingTabChange(tab);
        return;
      }
      // No data - just close and navigate
      setShowMeetingSetup(false);
      meetingSetupStore.reset();
    }

    // If clicking home while meeting setup is showing (no data), clear it
    if (showMeetingSetup && tab === 'home') {
      if (!hasMeetingSetupData()) {
        setShowMeetingSetup(false);
        meetingSetupStore.reset();
      }
      // If has data and clicking home, just show the dashboard
      setShowMeetingSetup(false);
      meetingSetupStore.reset();
    }

    setActiveTab(tab);
  };

  // Confirm discarding game setup and navigate
  const confirmDiscardMeetingSetup = () => {
    if (pendingTabChange) {
      setShowMeetingSetup(false);
      meetingSetupStore.reset();
      setActiveTab(pendingTabChange);
      setPendingTabChange(null);
    }
  };

  // Cancel discarding game setup
  const cancelDiscardMeetingSetup = () => {
    setPendingTabChange(null);
  };
  const { status: sessionStatus, startRecording } = useSession();
  const { allGranted, loading: permissionsLoading, checkPermissions } = usePermissions();
  const { prepareNewSession } = useSessionLifecycle();

  // Global listener for recorder events - persists during navigation
  useGlobalRecorderEvents();

  const isAuthenticated = configStore.isAuthenticated();

  // Handle clearing session errors
  const handleDismissError = () => {
    sessionStore.setError(null);
  };

  // Check if actively recording or processing
  const isActivelyRecording = sessionStatus === 'recording' || sessionStatus === 'processing' || sessionStatus === 'stopping' || sessionStatus === 'starting';

  // Track if we're waiting for call summary after recording ended
  const copilotCallActive = useCopilotStore((state) => state.isCallActive);
  const awaitingCallSummary = sessionStatus === 'idle' && copilotCallActive;

  React.useEffect(() => {
    if (isActivelyRecording && showMeetingSetup) {
      setShowMeetingSetup(false);
    }
  }, [isActivelyRecording, showMeetingSetup]);

  // Handle start recording — show GameSetupFlow over the Game Library
  const handleStartRecording = () => {
    prepareNewSession();
    setShowMeetingSetup(true);
    setActiveTab('home');
  };

  // Handle returning from recording/setup mode - navigate to history (detail page if we have a recording ID)
  const handleExitRecordingMode = () => {
    setShowMeetingSetup(false);

    // Capture recording ID before clearing state (may be null if something went wrong)
    const recordingId = sessionStore.recordingId;
    if (recordingId) {
      setPendingRecordingNavigation(recordingId);
    }

    // Always navigate to history - shows detail if we have ID, otherwise shows list
    setActiveTab('history');

    prepareNewSession();
  };

  const renderContent = () => {
    console.log('[App.renderContent] sessionStatus:', sessionStatus, 'isActivelyRecording:', isActivelyRecording, 'awaitingCallSummary:', awaitingCallSummary, 'activeTab:', activeTab);

    // Step 0: Auth
    if (!isAuthenticated) {
      return <AuthView />;
    }

    // Step 1: Permissions (loading state)
    if (permissionsLoading) {
      return (
        <div className="h-full w-full bg-surface-page flex flex-col items-center justify-center relative overflow-hidden">
          {/* Brand gradient glow */}
          <div
            className="absolute top-[-30%] left-1/2 -translate-x-1/2 w-[600px] h-[567px] rounded-[300px] pointer-events-none brand-glow-bg"
          />
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="w-8 h-8 text-brand animate-spin" />
            <p className="text-base text-text-body">Checking permissions...</p>
          </div>
        </div>
      );
    }

    // Step 1: Permissions
    if (!allGranted && activeTab !== 'settings') {
      return <PermissionsView onContinue={checkPermissions} />;
    }

    // Step 2: Recording preferences (optional onboarding step)
    if (showRecordingPrefs && activeTab !== 'settings') {
      return (
        <RecordingPreferencesView
          onComplete={() => {
            setShowRecordingPrefs(false);
            configStore.completeOnboarding();
          }}
        />
      );
    }

    // If actively recording OR waiting for call summary, show RecordingView
    if (isActivelyRecording || awaitingCallSummary) {
      return <RecordingView onBack={handleExitRecordingMode} />;
    }

    // If showing game setup flow (after clicking Start New Game)
    if (showMeetingSetup) {
      return (
        <div className="flex flex-col h-full bg-surface-page">
          <div className="flex-1 flex items-center justify-center overflow-auto py-8">
            <MeetingSetupFlow onCancel={() => setShowMeetingSetup(false)} />
          </div>
        </div>
      );
    }

    // Main app
    switch (activeTab) {
      case 'home':
        // Home tab = Game Library (the primary screen per Figma)
        return (
          <HistoryView
            initialSelectedRecordingId={pendingRecordingNavigation}
            onClearInitialSelection={() => setPendingRecordingNavigation(null)}
            onStartRecording={handleStartRecording}
          />
        );
      case 'history':
        return (
          <HistoryView
            initialSelectedRecordingId={pendingRecordingNavigation}
            onClearInitialSelection={() => setPendingRecordingNavigation(null)}
            onStartRecording={handleStartRecording}
          />
        );
      case 'settings':
        return (
          <SettingsView />
        );
    }
  };

  // Determine if we're in the setup flow (auth, permissions, or recording prefs)
  const isSetupFlow = !isAuthenticated ||
    (permissionsLoading || (!allGranted && activeTab !== 'settings') || (showRecordingPrefs && activeTab !== 'settings'));

  return (
    <div className="flex flex-col h-screen bg-white">
      {/* Title bar — only shown during setup/auth flow for traffic light spacing */}
      {isSetupFlow && (
        <div className="flex items-center shrink-0 drag-region relative h-[50px] bg-surface-page border-b border-black/10">
          <div className="absolute left-0 w-20 shrink-0" />
        </div>
      )}
      {/* Minimal drag region for main app — just enough for macOS traffic lights */}
      {!isSetupFlow && isAuthenticated && (
        <div className="flex items-center shrink-0 drag-region relative h-[28px] bg-white">
          <div className="absolute left-0 w-20 shrink-0" />
        </div>
      )}

      {/* Main layout below titlebar */}
      <div className="flex flex-1 overflow-hidden">
        {isAuthenticated && !isSetupFlow && (
          <NewSidebar activeTab={activeTab} onTabChange={handleTabChange} className="w-[72px] flex-shrink-0" />
        )}
        <div className="flex-1 overflow-hidden">{renderContent()}</div>
      </div>

      {/* Global Copilot Components */}
      {isAuthenticated && <NudgeToast position="bottom" />}
      <ErrorToast
        message={sessionStore.error}
        onDismiss={handleDismissError}
        position="bottom"
      />

      {/* Discard Game Setup Confirmation Dialog */}
      <Dialog open={pendingTabChange !== null} onOpenChange={(open) => !open && cancelDiscardMeetingSetup()}>
        <DialogContent className="max-w-[400px]">
          <DialogHeader>
            <div className="flex items-center gap-[12px]">
              <div className="w-[40px] h-[40px] bg-[var(--color-status-danger-bg)] rounded-[10px] flex items-center justify-center">
                <AlertTriangle className="w-[20px] h-[20px] text-danger" />
              </div>
              <div>
                <DialogTitle className="text-md font-semibold text-text-heading">
                  Discard game setup?
                </DialogTitle>
              </div>
            </div>
            <DialogDescription className="text-base text-text-body mt-[12px]">
              You have unsaved changes in your game setup. If you leave now, your progress will be lost.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex gap-[8px] mt-[16px]">
            <button
              onClick={cancelDiscardMeetingSetup}
              className="flex-1 px-[16px] py-[10px] border border-border-subtle rounded-[10px] text-base font-medium text-text-body hover:bg-surface-muted transition-colors"
            >
              Keep editing
            </button>
            <button
              onClick={confirmDiscardMeetingSetup}
              className="flex-1 px-[16px] py-[10px] bg-danger hover:bg-danger-hover rounded-[10px] text-base font-medium text-white transition-colors"
            >
              Discard
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
