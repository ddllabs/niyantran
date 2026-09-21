/**
 * One import for the panel's thread store. With VITE_AI_BACKEND=supabase the
 * conversations live on the server; otherwise the legacy localStorage store
 * runs exactly as it does today. `aiChatStore.js` is not edited by this
 * module — the legacy path must keep behaving as it always has.
 */
import { aiBackend } from './aiBackend.js';
import * as legacy from './aiChatStore.js';
import * as server from './aiConversations.js';

const onServer = aiBackend() === 'supabase';
const store = onServer ? server : legacy;

export const serverThreads = onServer;

export const loadAiState = store.loadAiState;
export const subscribeAiChats = store.subscribeAiChats;
export const activeAiChat = store.activeAiChat;
export const ensureAiChat = store.ensureAiChat;
export const createAiChat = store.createAiChat;
export const setActiveAiChat = store.setActiveAiChat;
export const renameAiChat = store.renameAiChat;
export const deleteAiChat = store.deleteAiChat;
export const setChatRole = store.setChatRole;
export const setChatAttachments = store.setChatAttachments;
export const addChatAttachments = store.addChatAttachments;
export const appendAiMessage = store.appendAiMessage;
export const patchAiMessage = store.patchAiMessage;

/** Server-only; no-ops on the legacy path so the panel can call them either way. */
export const hydrateConversations = onServer ? server.hydrateConversations : async () => legacy.loadAiState();
export const loadMessages = onServer ? server.loadMessages : async () => legacy.loadAiState();
export const reconcileTurn = onServer ? server.reconcileTurn : async () => legacy.loadAiState();
