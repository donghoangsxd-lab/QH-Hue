import { ADMIN_EMAILS } from '../config.js';
import { renderGroupedPoints } from './layerManager.js';

export let currentUserRole = "VIEWER";

export function toggleAuthModal() {
  const modal = document.getElementById('authModal');
  modal.style.display = modal.style.display === 'block' ? 'none' : 'block';
  document.getElementById('authMsg').innerText = "";
}

function parseJwt(token) {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(window.atob(base64).split('').map(function(c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
    return JSON.parse(jsonPayload);
  } catch (e) {
    return null;
  }
}

export function handleGoogleCredentialResponse(response) {
  const payload = parseJwt(response.credential);
  const msg = document.getElementById('authMsg');

  if (payload && payload.email) {
    const userEmail = payload.email.toLowerCase();
    
    if (ADMIN_EMAILS.includes(userEmail) || userEmail.endsWith("@hue.gov.vn")) {
      currentUserRole = "ADMIN";
      msg.style.color = "var(--accent-green)";
      msg.innerText = `✓ Xin chào Admin (${payload.name})`;
      
      const btnAuth = document.getElementById('btnAuth');
      btnAuth.style.color = "var(--accent-orange)";
      btnAuth.innerHTML = `🔓 ADMIN (${payload.name})`;

      setTimeout(() => {
        toggleAuthModal();
        renderGroupedPoints();
      }, 1000);
    } else {
      msg.style.color = "var(--accent-red)";
      msg.innerText = `❌ Email (${userEmail}) không có quyền Quản trị.`;
    }
  } else {
    msg.style.color = "var(--accent-red)";
    msg.innerText = "❌ Lỗi xác thực tài khoản Google!";
  }
}

window.handleGoogleCredentialResponse = handleGoogleCredentialResponse;
