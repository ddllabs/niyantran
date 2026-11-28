/**
 * Feature F341: Private File Manager & AI Indexing — Artifact Service.
 *
 * Implements lazy folder creation and durable file persistence for AI artifacts
 * (e.g. analysis briefs, executive summaries, data tables, code blocks)
 * directly into the authenticated user's private 'AI Artifacts' folder.
 *
 * Cross-references:
 * - Specification: docs/specs/private-file-manager-functionality.md (Section I)
 * - Implementation Plan: docs/plans/2026-11-14-private-file-manager.md (Task 6)
 */

import { supabase } from '../lib/supabaseClient.js';
import {
  prepareUpload,
  uploadBinary,
  completeUpload,
  calculateSha256,
  createFolder,
} from './fileManagerService.js';

export const AI_ARTIFACTS_FOLDER_NAME = 'AI Artifacts';

/**
 * Ensures that the system-level 'AI Artifacts' folder exists at the root of the user's hierarchy.
 * Creates it lazily if absent.
 *
 * @returns {Promise<any>} The user_folders entity for 'AI Artifacts'.
 */
export async function getOrCreateArtifactsFolder() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    throw new Error('User authentication required to access AI Artifacts folder.');
  }

  // Check for existing active root folder named 'AI Artifacts'
  const { data: existingFolder } = await supabase
    .from('user_folders')
    .select('*')
    .eq('user_id', user.id)
    .eq('name', AI_ARTIFACTS_FOLDER_NAME)
    .is('parent_id', null)
    .is('deleted_at', null)
    .maybeSingle();

  if (existingFolder) {
    return existingFolder;
  }

  // Create lazily at root
  return createFolder({
    name: AI_ARTIFACTS_FOLDER_NAME,
    parent_id: null,
  });
}

/**
 * Saves an AI-generated artifact (Markdown analysis, JSON table, CSV, etc.) into the user's File Manager.
 *
 * @param {{
 *   title: string,
 *   content: string | object,
 *   mime_type?: string,
 *   kind?: 'artifact' | 'table' | 'brief' | 'code',
 *   metadata?: {
 *     source_conversation_id?: string,
 *     source_turn_key?: string,
 *     model_served?: string,
 *     prompt_subject?: string
 *   }
 * }} params
 * @returns {Promise<{ success: boolean, file: any, folder: any }>}
 */
export async function saveArtifactToFiles({
  title,
  content,
  mime_type = 'text/markdown',
  kind: _kind = 'artifact',
  metadata: _metadata = {},
}) {
  if (!content) {
    throw new Error('Artifact content cannot be empty.');
  }

  // 1. Ensure target folder exists
  const folder = await getOrCreateArtifactsFolder();

  // 2. Prepare string payload and determine extension
  let textPayload = '';
  let extension = '.md';

  if (mime_type === 'application/json' || typeof content === 'object') {
    textPayload = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
    extension = '.json';
    mime_type = 'application/json';
  } else if (mime_type === 'text/csv') {
    textPayload = String(content);
    extension = '.csv';
  } else {
    textPayload = String(content);
    extension = '.md';
    mime_type = 'text/markdown';
  }

  // 3. Construct safe, clean file name
  const cleanTitle = (title || 'AI Analysis')
    .replace(/[/\\?%*:|"<>]/g, '_')
    .trim()
    .slice(0, 80);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const fileName = cleanTitle.toLowerCase().endsWith(extension)
    ? cleanTitle
    : `${cleanTitle} (${timestamp})${extension}`;

  const blob = new Blob([textPayload], { type: `${mime_type};charset=utf-8` });
  const sizeBytes = blob.size;

  // 4. Calculate cryptographic SHA-256
  const sha256 = await calculateSha256(blob);

  // 5. Prepare upload reservation
  const uploadPrep = await prepareUpload({
    name: fileName,
    mime_type,
    size_bytes: sizeBytes,
    folder_id: folder.id,
  });

  // 6. Upload binary
  await uploadBinary(uploadPrep.signed_upload_url, blob);

  // 7. Complete upload and commit record
  const result = await completeUpload({
    file_id: uploadPrep.file_id,
    sha256,
  });

  return {
    success: true,
    file: result.file || { id: uploadPrep.file_id, name: fileName, size_bytes: sizeBytes },
    folder,
  };
}
