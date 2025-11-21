/**
 * Firebase and Firestore initialization for Layout Module
 */

import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  getDocs,
  getDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  query,
  where,
  orderBy,
  serverTimestamp
} from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { firebaseConfig } from '../firebase-config.js';

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firestore
const db = getFirestore(app);

// Initialize Cloud Storage
const storage = getStorage(app);

// Collection references
const templatesCollection = collection(db, 'templates');
const pagesCollection = collection(db, 'pages');
const cardPairsCollection = collection(db, 'card_pairs');
const documentsCollection = collection(db, 'documents');
const groupsCollection = collection(db, 'groups');
const tagsCollection = collection(db, 'tags');

/**
 * Template Operations
 */

export async function getAllTemplates() {
  try {
    const q = query(templatesCollection, orderBy('name', 'asc'));
    const querySnapshot = await getDocs(q);
    const templates = [];
    querySnapshot.forEach((doc) => {
      templates.push({ id: doc.id, ...doc.data() });
    });
    return templates;
  } catch (error) {
    throw error;
  }
}

export async function getTemplate(templateId) {
  try {
    const templateRef = doc(db, 'templates', templateId);
    const templateSnap = await getDoc(templateRef);
    if (templateSnap.exists()) {
      return { id: templateSnap.id, ...templateSnap.data() };
    } else {
      throw new Error('Template not found');
    }
  } catch (error) {
    throw error;
  }
}

export async function createTemplate(templateData) {
  try {
    const docRef = await addDoc(templatesCollection, {
      ...templateData,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    return docRef.id;
  } catch (error) {
    throw error;
  }
}

export async function updateTemplate(templateId, templateData) {
  try {
    const templateRef = doc(db, 'templates', templateId);
    await updateDoc(templateRef, {
      ...templateData,
      updatedAt: serverTimestamp()
    });
  } catch (error) {
    throw error;
  }
}

export async function deleteTemplate(templateId) {
  try {
    const templateRef = doc(db, 'templates', templateId);
    await deleteDoc(templateRef);
  } catch (error) {
    throw error;
  }
}

/**
 * Page/Card Operations
 */

export async function getAllPages() {
  try {
    const q = query(pagesCollection, orderBy('pageName', 'asc'));
    const querySnapshot = await getDocs(q);
    const pages = [];
    querySnapshot.forEach((doc) => {
      pages.push({ id: doc.id, ...doc.data() });
    });
    return pages;
  } catch (error) {
    throw error;
  }
}

export async function getPage(pageId) {
  try {
    const pageRef = doc(db, 'pages', pageId);
    const pageSnap = await getDoc(pageRef);
    if (pageSnap.exists()) {
      return { id: pageSnap.id, ...pageSnap.data() };
    } else {
      throw new Error('Page not found');
    }
  } catch (error) {
    throw error;
  }
}

export async function createPage(pageData) {
  try {
    const docRef = await addDoc(pagesCollection, {
      ...pageData,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    return docRef.id;
  } catch (error) {
    throw error;
  }
}

export async function updatePage(pageId, pageData) {
  try {
    const pageRef = doc(db, 'pages', pageId);
    await updateDoc(pageRef, {
      ...pageData,
      updatedAt: serverTimestamp()
    });
  } catch (error) {
    throw error;
  }
}

export async function deletePage(pageId) {
  try {
    const pageRef = doc(db, 'pages', pageId);
    await deleteDoc(pageRef);
  } catch (error) {
    throw error;
  }
}

export async function searchPages(searchText) {
  try {
    const allPages = await getAllPages();
    if (!searchText) return allPages;

    const searchLower = searchText.toLowerCase();
    return allPages.filter(page =>
      page.pageName?.toLowerCase().includes(searchLower) ||
      page.content?.toLowerCase().includes(searchLower)
    );
  } catch (error) {
    throw error;
  }
}

/**
 * Card Pair Operations (Poker card fronts/backs)
 */

export async function getAllCardPairs() {
  try {
    const q = query(cardPairsCollection, orderBy('name', 'asc'));
    const querySnapshot = await getDocs(q);
    const pairs = [];
    querySnapshot.forEach((doc) => {
      pairs.push({ id: doc.id, ...doc.data() });
    });
    return pairs;
  } catch (error) {
    throw error;
  }
}

export async function getCardPair(pairId) {
  try {
    const pairRef = doc(db, 'card_pairs', pairId);
    const pairSnap = await getDoc(pairRef);
    if (pairSnap.exists()) {
      return { id: pairSnap.id, ...pairSnap.data() };
    } else {
      throw new Error('Card pair not found');
    }
  } catch (error) {
    throw error;
  }
}

export async function createCardPair(pairData) {
  try {
    const docRef = await addDoc(cardPairsCollection, {
      ...pairData,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    return docRef.id;
  } catch (error) {
    throw error;
  }
}

export async function updateCardPair(pairId, pairData) {
  try {
    const pairRef = doc(db, 'card_pairs', pairId);
    await updateDoc(pairRef, {
      ...pairData,
      updatedAt: serverTimestamp()
    });
  } catch (error) {
    throw error;
  }
}

export async function deleteCardPair(pairId) {
  try {
    const pairRef = doc(db, 'card_pairs', pairId);
    await deleteDoc(pairRef);
  } catch (error) {
    throw error;
  }
}

/**
 * Document Operations
 */

export async function getAllDocuments() {
  try {
    const q = query(documentsCollection, orderBy('name', 'asc'));
    const querySnapshot = await getDocs(q);
    const documents = [];
    querySnapshot.forEach((doc) => {
      documents.push({ id: doc.id, ...doc.data() });
    });
    return documents;
  } catch (error) {
    throw error;
  }
}

export async function getDocument(documentId) {
  try {
    const documentRef = doc(db, 'documents', documentId);
    const documentSnap = await getDoc(documentRef);
    if (documentSnap.exists()) {
      return { id: documentSnap.id, ...documentSnap.data() };
    } else {
      throw new Error('Document not found');
    }
  } catch (error) {
    throw error;
  }
}

export async function createDocument(documentData) {
  try {
    const docRef = await addDoc(documentsCollection, {
      ...documentData,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    return docRef.id;
  } catch (error) {
    throw error;
  }
}

export async function updateDocument(documentId, documentData) {
  try {
    const documentRef = doc(db, 'documents', documentId);
    await updateDoc(documentRef, {
      ...documentData,
      updatedAt: serverTimestamp()
    });
  } catch (error) {
    throw error;
  }
}

export async function deleteDocument(documentId) {
  try {
    const documentRef = doc(db, 'documents', documentId);
    await deleteDoc(documentRef);
  } catch (error) {
    throw error;
  }
}

export async function getDocumentsByGroup(groupId) {
  try {
    const q = query(documentsCollection, where('groupId', '==', groupId), orderBy('name', 'asc'));
    const querySnapshot = await getDocs(q);
    const documents = [];
    querySnapshot.forEach((doc) => {
      documents.push({ id: doc.id, ...doc.data() });
    });
    return documents;
  } catch (error) {
    throw error;
  }
}

/**
 * Group Operations (Hierarchical organization)
 */

export async function getAllGroups() {
  try {
    const q = query(groupsCollection, orderBy('name', 'asc'));
    const querySnapshot = await getDocs(q);
    const groups = [];
    querySnapshot.forEach((doc) => {
      groups.push({ id: doc.id, ...doc.data() });
    });
    return groups;
  } catch (error) {
    throw error;
  }
}

export async function getGroup(groupId) {
  try {
    const groupRef = doc(db, 'groups', groupId);
    const groupSnap = await getDoc(groupRef);
    if (groupSnap.exists()) {
      return { id: groupSnap.id, ...groupSnap.data() };
    } else {
      throw new Error('Group not found');
    }
  } catch (error) {
    throw error;
  }
}

export async function createGroup(groupData) {
  try {
    const docRef = await addDoc(groupsCollection, {
      ...groupData,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    return docRef.id;
  } catch (error) {
    throw error;
  }
}

export async function updateGroup(groupId, groupData) {
  try {
    const groupRef = doc(db, 'groups', groupId);
    await updateDoc(groupRef, {
      ...groupData,
      updatedAt: serverTimestamp()
    });
  } catch (error) {
    throw error;
  }
}

export async function deleteGroup(groupId) {
  try {
    const groupRef = doc(db, 'groups', groupId);
    await deleteDoc(groupRef);
  } catch (error) {
    throw error;
  }
}

/**
 * Tag Operations
 */

export async function getAllTags() {
  try {
    const q = query(tagsCollection, orderBy('name', 'asc'));
    const querySnapshot = await getDocs(q);
    const tags = [];
    querySnapshot.forEach((doc) => {
      tags.push({ id: doc.id, ...doc.data() });
    });
    return tags;
  } catch (error) {
    throw error;
  }
}

export async function createTag(tagData) {
  try {
    const docRef = await addDoc(tagsCollection, {
      ...tagData,
      createdAt: serverTimestamp()
    });
    return docRef.id;
  } catch (error) {
    throw error;
  }
}

export async function deleteTag(tagId) {
  try {
    const tagRef = doc(db, 'tags', tagId);
    await deleteDoc(tagRef);
  } catch (error) {
    throw error;
  }
}

/**
 * Cloud Storage Operations (Images)
 */

export async function uploadImage(file, path) {
  try {
    const storageRef = ref(storage, path);
    const snapshot = await uploadBytes(storageRef, file);
    const downloadURL = await getDownloadURL(snapshot.ref);
    return {
      path: snapshot.ref.fullPath,
      url: downloadURL
    };
  } catch (error) {
    throw error;
  }
}

export async function deleteImage(path) {
  try {
    const storageRef = ref(storage, path);
    await deleteObject(storageRef);
  } catch (error) {
    throw error;
  }
}

export async function getImageURL(path) {
  try {
    const storageRef = ref(storage, path);
    return await getDownloadURL(storageRef);
  } catch (error) {
    throw error;
  }
}

/**
 * Utility function to calculate SHA256 hash of a file
 * Used for image deduplication
 */
export async function calculateFileSHA256(file) {
  const arrayBuffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}

export { db, storage };
