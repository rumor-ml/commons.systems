// Firebase operations for Print site
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, getDoc, doc, addDoc, updateDoc, deleteDoc, query, orderBy, Timestamp } from 'firebase/firestore';
import { getStorage, ref, uploadBytesResumable, getDownloadURL, getMetadata, deleteObject } from 'firebase/storage';
import { firebaseConfig } from '../firebase-config.js';

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);

/**
 * Get all documents from Firestore
 * @returns {Promise<Array>} Array of document objects with id
 */
export async function getAllDocuments() {
  try {
    const q = query(collection(db, 'documents'), orderBy('uploadedAt', 'desc'));
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      uploadedAt: doc.data().uploadedAt?.toDate()
    }));
  } catch (error) {
    console.error('Error getting documents:', error);
    throw error;
  }
}

/**
 * Get a single document by ID
 * @param {string} documentId - Document ID
 * @returns {Promise<Object>} Document object with id
 */
export async function getDocument(documentId) {
  try {
    const docRef = doc(db, 'documents', documentId);
    const docSnap = await getDoc(docRef);

    if (!docSnap.exists()) {
      throw new Error('Document not found');
    }

    return {
      id: docSnap.id,
      ...docSnap.data(),
      uploadedAt: docSnap.data().uploadedAt?.toDate()
    };
  } catch (error) {
    console.error('Error getting document:', error);
    throw error;
  }
}

/**
 * Create a new document record in Firestore
 * @param {Object} documentData - Document metadata
 * @returns {Promise<string>} Document ID
 */
export async function createDocument(documentData) {
  try {
    const docRef = await addDoc(collection(db, 'documents'), {
      ...documentData,
      uploadedAt: Timestamp.now(),
      lastRead: null,
      readProgress: 0,
      bookmarks: []
    });
    return docRef.id;
  } catch (error) {
    console.error('Error creating document:', error);
    throw error;
  }
}

/**
 * Update document metadata
 * @param {string} documentId - Document ID
 * @param {Object} updates - Fields to update
 * @returns {Promise<void>}
 */
export async function updateDocument(documentId, updates) {
  try {
    const docRef = doc(db, 'documents', documentId);
    await updateDoc(docRef, updates);
  } catch (error) {
    console.error('Error updating document:', error);
    throw error;
  }
}

/**
 * Delete a document from Firestore
 * @param {string} documentId - Document ID
 * @returns {Promise<void>}
 */
export async function deleteDocument(documentId) {
  try {
    const docRef = doc(db, 'documents', documentId);
    await deleteDoc(docRef);
  } catch (error) {
    console.error('Error deleting document:', error);
    throw error;
  }
}

/**
 * Upload a file to Firebase Storage
 * @param {File} file - File to upload
 * @param {Function} progressCallback - Callback for progress updates (0-100)
 * @returns {Promise<Object>} Object with storagePath and downloadURL
 */
export async function uploadFile(file, progressCallback) {
  try {
    const fileName = `${Date.now()}_${file.name}`;
    const storageRef = ref(storage, `print/${fileName}`);
    const uploadTask = uploadBytesResumable(storageRef, file);

    return new Promise((resolve, reject) => {
      uploadTask.on('state_changed',
        (snapshot) => {
          const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          if (progressCallback) {
            progressCallback(progress);
          }
        },
        (error) => {
          console.error('Upload error:', error);
          reject(error);
        },
        async () => {
          try {
            const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
            resolve({
              storagePath: `print/${fileName}`,
              downloadURL
            });
          } catch (error) {
            reject(error);
          }
        }
      );
    });
  } catch (error) {
    console.error('Error uploading file:', error);
    throw error;
  }
}

/**
 * Delete a file from Firebase Storage
 * @param {string} storagePath - Storage path (e.g., 'print/filename.pdf')
 * @returns {Promise<void>}
 */
export async function deleteFile(storagePath) {
  try {
    const storageRef = ref(storage, storagePath);
    await deleteObject(storageRef);
  } catch (error) {
    console.error('Error deleting file:', error);
    throw error;
  }
}

/**
 * Get download URL for a file
 * @param {string} storagePath - Storage path
 * @returns {Promise<string>} Download URL
 */
export async function getFileURL(storagePath) {
  try {
    const storageRef = ref(storage, storagePath);
    return await getDownloadURL(storageRef);
  } catch (error) {
    console.error('Error getting file URL:', error);
    throw error;
  }
}

/**
 * Get file metadata from Storage
 * @param {string} storagePath - Storage path
 * @returns {Promise<Object>} File metadata
 */
export async function getFileMetadata(storagePath) {
  try {
    const storageRef = ref(storage, storagePath);
    return await getMetadata(storageRef);
  } catch (error) {
    console.error('Error getting file metadata:', error);
    throw error;
  }
}

/**
 * Update read progress for a document
 * @param {string} documentId - Document ID
 * @param {number} progress - Progress percentage (0-100)
 * @returns {Promise<void>}
 */
export async function updateReadProgress(documentId, progress) {
  try {
    await updateDocument(documentId, {
      lastRead: Timestamp.now(),
      readProgress: Math.min(100, Math.max(0, progress))
    });
  } catch (error) {
    console.error('Error updating read progress:', error);
    throw error;
  }
}

/**
 * Add a bookmark to a document
 * @param {string} documentId - Document ID
 * @param {Object} bookmark - Bookmark data (page, position, note, etc.)
 * @returns {Promise<void>}
 */
export async function addBookmark(documentId, bookmark) {
  try {
    const document = await getDocument(documentId);
    const bookmarks = document.bookmarks || [];
    bookmarks.push({
      ...bookmark,
      createdAt: new Date().toISOString()
    });
    await updateDocument(documentId, { bookmarks });
  } catch (error) {
    console.error('Error adding bookmark:', error);
    throw error;
  }
}

/**
 * Detect file type from filename
 * @param {string} filename - Filename with extension
 * @returns {string} File type (pdf, epub, md, cbz, cbr)
 */
export function detectFileType(filename) {
  const extension = filename.split('.').pop().toLowerCase();
  const typeMap = {
    'pdf': 'pdf',
    'epub': 'epub',
    'md': 'md',
    'markdown': 'md',
    'cbz': 'cbz',
    'cbr': 'cbr'
  };
  return typeMap[extension] || 'unknown';
}

/**
 * Format file size in human-readable format
 * @param {number} bytes - File size in bytes
 * @returns {string} Formatted size
 */
export function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}
