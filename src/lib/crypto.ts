/**
 * Crypto utilities for encrypting/decrypting API keys using AES-256-GCM
 */

/**
 * Convert a string to ArrayBuffer
 */
function stringToBuffer(str: string): ArrayBuffer {
  const encoder = new TextEncoder();
  return encoder.encode(str);
}

/**
 * Convert ArrayBuffer to string
 */
function bufferToString(buffer: ArrayBuffer): string {
  const decoder = new TextDecoder();
  return decoder.decode(buffer);
}

/**
 * Convert ArrayBuffer to Base64 string
 */
function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Convert Base64 string to ArrayBuffer
 */
function base64ToBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Derive a CryptoKey from a secret string using PBKDF2
 */
async function deriveKey(
  secret: string,
  salt: ArrayBuffer,
): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    stringToBuffer(secret),
    "PBKDF2",
    false,
    ["deriveBits", "deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Encrypt plaintext using AES-256-GCM
 * @param plaintext - The text to encrypt
 * @param secret - The secret key for encryption
 * @returns Encrypted string in format: "iv:authTag:ciphertext" (Base64 encoded)
 */
export async function encrypt(
  plaintext: string,
  secret: string,
): Promise<string> {
  try {
    // Generate random IV (12 bytes for GCM)
    const iv = crypto.getRandomValues(new Uint8Array(12));

    // Generate random salt for key derivation
    const salt = crypto.getRandomValues(new Uint8Array(16));

    // Derive encryption key from secret
    const key = await deriveKey(secret, salt);

    // Encrypt the plaintext
    const encrypted = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: iv,
      },
      key,
      stringToBuffer(plaintext),
    );

    // Extract auth tag (last 16 bytes) and ciphertext
    const encryptedArray = new Uint8Array(encrypted);
    const ciphertext = encryptedArray.slice(0, -16);
    const authTag = encryptedArray.slice(-16);

    // Return format: salt:iv:authTag:ciphertext (all Base64 encoded)
    return [
      bufferToBase64(salt),
      bufferToBase64(iv),
      bufferToBase64(authTag),
      bufferToBase64(ciphertext),
    ].join(":");
  } catch (error) {
    throw new Error(
      `Encryption failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

/**
 * Decrypt ciphertext using AES-256-GCM
 * @param ciphertext - Encrypted string in format: "salt:iv:authTag:ciphertext" (Base64 encoded)
 * @param secret - The secret key for decryption
 * @returns Decrypted plaintext
 */
export async function decrypt(
  ciphertext: string,
  secret: string,
): Promise<string> {
  try {
    // Parse the encrypted data
    const parts = ciphertext.split(":");
    if (parts.length !== 4) {
      throw new Error(
        "Invalid ciphertext format. Expected format: salt:iv:authTag:ciphertext",
      );
    }

    const [saltB64, ivB64, authTagB64, ciphertextB64] = parts;

    // Decode Base64 strings to ArrayBuffers
    const salt = base64ToBuffer(saltB64);
    const iv = base64ToBuffer(ivB64);
    const authTag = base64ToBuffer(authTagB64);
    const encryptedData = base64ToBuffer(ciphertextB64);

    // Derive decryption key from secret
    const key = await deriveKey(secret, salt);

    // Combine ciphertext and auth tag for decryption
    const combined = new Uint8Array(
      encryptedData.byteLength + authTag.byteLength,
    );
    combined.set(new Uint8Array(encryptedData), 0);
    combined.set(new Uint8Array(authTag), encryptedData.byteLength);

    // Decrypt the data
    const decrypted = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: new Uint8Array(iv),
      },
      key,
      combined,
    );

    return bufferToString(decrypted);
  } catch (error) {
    throw new Error(
      `Decryption failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

/**
 * Mask an API key for display purposes
 * @param apiKey - The API key to mask
 * @returns Masked API key as "***"
 * @example maskApiKey("sk-proj-abc123xyz789") => "***"
 */
export function maskApiKey(_apiKey: string): string {
  return "***";
}
