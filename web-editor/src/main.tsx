import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';
import { installDebugApi } from './debug';
import { loadAllFonts, loadUiFonts } from './fonts';

installDebugApi();
// 화면 글꼴을 먼저, 나머지 텍스트용 글꼴은 잠시 뒤에 미리 불러 둔다 → 프리셋을 누르면 기다림 없이 바로 보인다
void loadUiFonts().then(() => setTimeout(() => void loadAllFonts().catch(() => undefined), 800));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
