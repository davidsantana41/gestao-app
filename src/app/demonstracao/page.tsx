import { notFound } from 'next/navigation';
import EntregaLocal from '@/components/gestao/EntregaLocal';
import { DashboardFinanceiroLocal } from '../page';

export const dynamic = 'force-dynamic';

export default function Demonstracao() {
  if (process.env.APPCAR_DEMO_LOCAL !== '1') notFound();
  const { FIRESTORE_EMULATOR_HOST, FIREBASE_AUTH_EMULATOR_HOST, FIREBASE_EMULATOR_HUB, GCLOUD_PROJECT,
    APPCAR_FINANCEIRO_UID: uid, APPCAR_FINANCEIRO_ESPACO: espacoId, APPCAR_FINANCEIRO_EMAIL: email,
    APPCAR_FINANCEIRO_SENHA: senha } = process.env;
  if (FIRESTORE_EMULATOR_HOST === '127.0.0.1:8091' && FIREBASE_AUTH_EMULATOR_HOST === '127.0.0.1:9097'
      && FIREBASE_EMULATOR_HUB === '127.0.0.1:4415' && GCLOUD_PROJECT === 'demo-appcar-financeiro'
      && uid && espacoId && email?.endsWith('@appcar.test') && senha) {
    return <DashboardFinanceiroLocal sessao={{ uid, espacoId, email, senha }} />;
  }
  if (FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8089') notFound();
  return <EntregaLocal />;
}
