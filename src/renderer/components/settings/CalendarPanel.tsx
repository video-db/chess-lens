/**
 * Calendar Panel Component
 *
 * Settings panel for connecting/disconnecting Google Calendar.
 */

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import {
  Calendar,
  Check,
  Loader2,
  LogOut,
  RefreshCw,
  AlertCircle,
} from 'lucide-react';
import type { UpcomingMeeting } from '../../../shared/types/calendar.types';

type CalendarStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export function CalendarPanel() {
  const [status, setStatus] = useState<CalendarStatus>('disconnected');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [upcomingEvents, setUpcomingEvents] = useState<UpcomingMeeting[]>([]);

  // Check auth status on mount
  useEffect(() => {
    checkAuthStatus();

    // Listen for events updates
    const unsubscribe = window.electronAPI.calendarOn.onEventsUpdated((events) => {
      setUpcomingEvents(events);
    });

    // Listen for auth required
    const unsubAuthRequired = window.electronAPI.calendarOn.onAuthRequired(() => {
      setStatus('error');
      setError('Calendar session expired. Please reconnect.');
    });

    return () => {
      unsubscribe();
      unsubAuthRequired();
    };
  }, []);

  const checkAuthStatus = async () => {
    setIsLoading(true);
    try {
      const result = await window.electronAPI.calendar.isSignedIn();
      if (result.success && result.isSignedIn) {
        setStatus('connected');
        // Fetch initial events
        const eventsResult = await window.electronAPI.calendar.getUpcomingEvents(24);
        if (eventsResult.success && eventsResult.events) {
          setUpcomingEvents(eventsResult.events);
        }
      } else {
        setStatus('disconnected');
      }
      setError(null);
    } catch (err) {
      setStatus('error');
      setError('Failed to check calendar status');
    } finally {
      setIsLoading(false);
    }
  };

  const handleConnect = async () => {
    setStatus('connecting');
    setError(null);
    try {
      const result = await window.electronAPI.calendar.signIn();
      if (result.success) {
        setStatus('connected');
        // Fetch events after connecting
        const eventsResult = await window.electronAPI.calendar.getUpcomingEvents(24);
        if (eventsResult.success && eventsResult.events) {
          setUpcomingEvents(eventsResult.events);
        }
      } else {
        setStatus('error');
        setError(result.error || 'Failed to connect');
      }
    } catch (err) {
      setStatus('error');
      setError('Connection failed');
    }
  };

  const handleDisconnect = async () => {
    setIsLoading(true);
    try {
      await window.electronAPI.calendar.signOut();
      setStatus('disconnected');
      setUpcomingEvents([]);
      setError(null);
    } catch (err) {
      setError('Failed to disconnect');
    } finally {
      setIsLoading(false);
    }
  };

  const getStatusBadge = () => {
    switch (status) {
      case 'connected':
        return (
          <Badge className="bg-green-500 text-white">
            <Check className="h-3 w-3 mr-1" />
            Connected
          </Badge>
        );
      case 'connecting':
        return (
          <Badge variant="secondary" className="animate-pulse">
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            Connecting...
          </Badge>
        );
      case 'error':
        return (
          <Badge variant="destructive">
            <AlertCircle className="h-3 w-3 mr-1" />
            Error
          </Badge>
        );
      default:
        return (
          <Badge variant="outline">
            Not Connected
          </Badge>
        );
    }
  };

  const formatEventTime = (event: UpcomingMeeting) => {
    if (event.isAllDay) return 'All day';
    return event.startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Google Calendar
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Get notified before your meetings start
          </p>
        </div>
        <div className="flex items-center gap-2">
          {getStatusBadge()}
          {status === 'connected' && (
            <Button variant="outline" size="icon" onClick={checkAuthStatus} disabled={isLoading}>
              <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            </Button>
          )}
        </div>
      </div>

      {/* Connection Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Calendar Connection</CardTitle>
          <CardDescription>
            Connect your Google Calendar to receive notifications 2 minutes before meetings start.
            The app will run in your system tray to monitor upcoming events.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg">
              <p className="text-sm text-red-600 dark:text-red-400 flex items-center gap-2">
                <AlertCircle className="h-4 w-4" />
                {error}
              </p>
            </div>
          )}

          {status === 'disconnected' && (
            <div className="flex flex-col items-center py-6">
              <Calendar className="h-12 w-12 text-slate-300 dark:text-slate-600 mb-4" />
              <p className="text-sm text-slate-500 dark:text-slate-400 text-center mb-4">
                Connect your Google Calendar to get started
              </p>
              <Button onClick={handleConnect}>
                <Calendar className="h-4 w-4 mr-2" />
                Connect Google Calendar
              </Button>
            </div>
          )}

          {status === 'connecting' && (
            <div className="flex flex-col items-center py-6">
              <Loader2 className="h-12 w-12 text-blue-500 mb-4 animate-spin" />
              <p className="text-sm text-slate-500 dark:text-slate-400 text-center">
                Connecting to Google Calendar...
              </p>
              <p className="text-xs text-slate-400 dark:text-slate-500 text-center mt-2">
                A browser window will open for authorization
              </p>
            </div>
          )}

          {status === 'connected' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-3 bg-green-50 dark:bg-green-950/30 rounded-lg">
                <div className="flex items-center gap-2">
                  <Check className="h-5 w-5 text-green-500" />
                  <span className="text-sm font-medium text-green-700 dark:text-green-300">
                    Calendar connected
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDisconnect}
                  disabled={isLoading}
                >
                  <LogOut className="h-4 w-4 mr-2" />
                  Disconnect
                </Button>
              </div>

              {/* Upcoming Events Preview */}
              {upcomingEvents.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    Upcoming Meetings (next 24h)
                  </h4>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {upcomingEvents.slice(0, 5).map((event) => (
                      <div
                        key={event.id}
                        className="flex items-center justify-between p-2 bg-slate-50 dark:bg-slate-800/50 rounded"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{event.summary}</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {formatEventTime(event)}
                            {event.minutesUntil > 0 && event.minutesUntil <= 60 && (
                              <span className="ml-2 text-amber-600 dark:text-amber-400">
                                in {event.minutesUntil}m
                              </span>
                            )}
                          </p>
                        </div>
                        {event.meetLink && (
                          <Badge variant="outline" className="text-xs ml-2">
                            Meet
                          </Badge>
                        )}
                      </div>
                    ))}
                  </div>
                  {upcomingEvents.length > 5 && (
                    <p className="text-xs text-slate-500 dark:text-slate-400 text-center">
                      +{upcomingEvents.length - 5} more events
                    </p>
                  )}
                </div>
              )}

              {upcomingEvents.length === 0 && (
                <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-4">
                  No upcoming meetings in the next 24 hours
                </p>
              )}
            </div>
          )}

          {status === 'error' && (
            <div className="flex flex-col items-center py-6">
              <AlertCircle className="h-12 w-12 text-red-400 mb-4" />
              <p className="text-sm text-slate-500 dark:text-slate-400 text-center mb-4">
                {error || 'Something went wrong'}
              </p>
              <Button onClick={handleConnect}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Try Again
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Info Card */}
      <Card>
        <CardContent className="pt-6">
          <div className="space-y-3 text-sm text-slate-600 dark:text-slate-400">
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center shrink-0">
                <span className="text-xs font-medium text-blue-600 dark:text-blue-400">1</span>
              </div>
              <p>
                <strong>System Tray:</strong> When you close the app, it continues running in your
                system tray to monitor your calendar.
              </p>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center shrink-0">
                <span className="text-xs font-medium text-blue-600 dark:text-blue-400">2</span>
              </div>
              <p>
                <strong>Notifications:</strong> You'll receive a notification 2 minutes before each
                meeting starts.
              </p>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center shrink-0">
                <span className="text-xs font-medium text-blue-600 dark:text-blue-400">3</span>
              </div>
              <p>
                <strong>Privacy:</strong> Your calendar data stays on your device. We only read
                event titles and times to send notifications.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default CalendarPanel;
