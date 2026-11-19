import js from '@eslint/js';
import ts from 'typescript-eslint';
export default ts.config({ignores:['dist','coverage']},js.configs.recommended,...ts.configs.recommended,{files:['src/**/*.{ts,tsx}'],languageOptions:{globals:{window:'readonly',document:'readonly',fetch:'readonly',URLSearchParams:'readonly',HTMLFormElement:'readonly',FormData:'readonly',RequestInit:'readonly',Response:'readonly',console:'readonly'}}});
