import { and, desc, eq } from 'drizzle-orm';
import * as schema from './schema';
import { getDatabase } from './connection';

export function createMCPServer(data: schema.NewMCPServer) {
  const database = getDatabase();
  return database.insert(schema.mcpServers).values(data).returning().get();
}

export function getMCPServerById(id: string) {
  const database = getDatabase();
  return database
    .select()
    .from(schema.mcpServers)
    .where(eq(schema.mcpServers.id, id))
    .get();
}

export function getAllMCPServers() {
  const database = getDatabase();
  return database
    .select()
    .from(schema.mcpServers)
    .orderBy(schema.mcpServers.createdAt)
    .all();
}

export function getEnabledMCPServers() {
  const database = getDatabase();
  return database
    .select()
    .from(schema.mcpServers)
    .where(eq(schema.mcpServers.isEnabled, true))
    .all();
}

export function getAutoConnectMCPServers() {
  const database = getDatabase();
  return database
    .select()
    .from(schema.mcpServers)
    .where(and(
      eq(schema.mcpServers.isEnabled, true),
      eq(schema.mcpServers.autoConnect, true)
    ))
    .all();
}

export function updateMCPServer(id: string, data: Partial<schema.MCPServer>) {
  const database = getDatabase();
  return database
    .update(schema.mcpServers)
    .set({ ...data, updatedAt: new Date().toISOString() })
    .where(eq(schema.mcpServers.id, id))
    .returning()
    .get();
}

export function updateMCPServerStatus(
  id: string,
  status: 'disconnected' | 'connecting' | 'connected' | 'error',
  error?: string
) {
  const database = getDatabase();
  const updates: Partial<schema.MCPServer> = {
    connectionStatus: status,
    updatedAt: new Date().toISOString(),
  };

  if (status === 'connected') {
    updates.lastConnectedAt = new Date().toISOString();
    updates.lastError = null;
  } else if (status === 'error' && error) {
    updates.lastError = error;
  }

  return database
    .update(schema.mcpServers)
    .set(updates)
    .where(eq(schema.mcpServers.id, id))
    .returning()
    .get();
}

export function deleteMCPServer(id: string) {
  const database = getDatabase();
  return database.delete(schema.mcpServers).where(eq(schema.mcpServers.id, id)).run();
}

export function createMCPToolCall(data: schema.NewMCPToolCall) {
  const database = getDatabase();
  return database.insert(schema.mcpToolCalls).values(data).returning().get();
}

export function getMCPToolCallById(id: string) {
  const database = getDatabase();
  return database
    .select()
    .from(schema.mcpToolCalls)
    .where(eq(schema.mcpToolCalls.id, id))
    .get();
}

export function getMCPToolCallsByServer(serverId: string) {
  const database = getDatabase();
  return database
    .select()
    .from(schema.mcpToolCalls)
    .where(eq(schema.mcpToolCalls.serverId, serverId))
    .orderBy(desc(schema.mcpToolCalls.createdAt))
    .all();
}

export function getMCPToolCallsByRecording(recordingId: number) {
  const database = getDatabase();
  return database
    .select()
    .from(schema.mcpToolCalls)
    .where(eq(schema.mcpToolCalls.recordingId, recordingId))
    .orderBy(schema.mcpToolCalls.createdAt)
    .all();
}

export function updateMCPToolCall(id: string, data: Partial<schema.MCPToolCall>) {
  const database = getDatabase();
  return database
    .update(schema.mcpToolCalls)
    .set(data)
    .where(eq(schema.mcpToolCalls.id, id))
    .returning()
    .get();
}

export function getMCPOauthToken(serverId: string) {
  const database = getDatabase();
  return database
    .select()
    .from(schema.mcpOauthTokens)
    .where(eq(schema.mcpOauthTokens.serverId, serverId))
    .get();
}

export function upsertMCPOauthToken(data: schema.NewMCPOauthToken) {
  const database = getDatabase();
  const existing = database
    .select()
    .from(schema.mcpOauthTokens)
    .where(eq(schema.mcpOauthTokens.serverId, data.serverId))
    .get();

  if (existing) {
    return database
      .update(schema.mcpOauthTokens)
      .set({ ...data, updatedAt: new Date().toISOString() })
      .where(eq(schema.mcpOauthTokens.serverId, data.serverId))
      .returning()
      .get();
  }
  return database.insert(schema.mcpOauthTokens).values(data).returning().get();
}

export function deleteMCPOauthToken(serverId: string) {
  const database = getDatabase();
  return database
    .delete(schema.mcpOauthTokens)
    .where(eq(schema.mcpOauthTokens.serverId, serverId))
    .run();
}
