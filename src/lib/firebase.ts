import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

// As chaves do seu projeto APPCAR
const producao = {
  apiKey: "AIzaSyC6TFMhMcpnyr5QyCeThSlY3NSTFS6V-88",
  authDomain: "appcar-a0886.firebaseapp.com",
  projectId: "appcar-a0886",
  storageBucket: "appcar-a0886.firebasestorage.app",
  messagingSenderId: "895145156895",
  appId: "1:895145156895:web:78fdcf55ed9afb40bb182a",
  measurementId: "G-TQSZ9P4VZR"
};

const homologacao = process.env.NEXT_PUBLIC_APPCAR_HOMOLOGACAO === '1';
const firebaseConfig = homologacao ? {
  apiKey: process.env.NEXT_PUBLIC_APPCAR_HML_API_KEY,
  authDomain: 'appcar-hml-895145.firebaseapp.com',
  projectId: 'appcar-hml-895145',
  appId: process.env.NEXT_PUBLIC_APPCAR_HML_APP_ID,
} : producao;

// Evita inicializar o Firebase mais de uma vez no Next.js
const nomeApp = homologacao ? 'appcar-homologacao' : '[DEFAULT]';
const app = getApps().some(item => item.name === nomeApp)
  ? getApp(nomeApp)
  : initializeApp(firebaseConfig, nomeApp);

// Exportamos o Banco de Dados (Firestore) e o Sistema de Login (Auth) para usar no aplicativo
export const db = getFirestore(app);
export const auth = getAuth(app);
auth.languageCode = 'pt-BR';
