import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

// As chaves do seu projeto APPCAR
const firebaseConfig = {
  apiKey: "AIzaSyC6TFMhMcpnyr5QyCeThSlY3NSTFS6V-88",
  authDomain: "appcar-a0886.firebaseapp.com",
  projectId: "appcar-a0886",
  storageBucket: "appcar-a0886.firebasestorage.app",
  messagingSenderId: "895145156895",
  appId: "1:895145156895:web:78fdcf55ed9afb40bb182a",
  measurementId: "G-TQSZ9P4VZR"
};

// Evita inicializar o Firebase mais de uma vez no Next.js
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

// Exportamos o Banco de Dados (Firestore) e o Sistema de Login (Auth) para usar no aplicativo
export const db = getFirestore(app);
export const auth = getAuth(app);