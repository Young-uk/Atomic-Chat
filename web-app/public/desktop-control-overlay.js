let submittingId = null;
let renderedApprovalId = null;
const approveButton = document.querySelector('#approve');
const denyButton = document.querySelector('#deny');
const feedback = document.querySelector('#feedback');
window.renderActivity = function () {
  const [title, detail, approvalId] = window.atomicDesktopActivity || [];
  document.querySelector('h1').textContent = title || '';
  const body = document.querySelector('p');
  body.textContent = detail || '';
  if (!approvalId) body.scrollTop = body.scrollHeight;
  else if (approvalId !== renderedApprovalId) body.scrollTop = 0;
  renderedApprovalId = approvalId;
  document.querySelector('#actions').hidden = !approvalId;
  const busy = Boolean(approvalId && submittingId === approvalId);
  approveButton.disabled = busy;
  denyButton.disabled = busy;
  feedback.textContent = busy ? 'Sending decision…' : '';
};
async function decide(decision) {
  const approvalId = window.atomicDesktopActivity?.[2];
  if (!approvalId || submittingId === approvalId) return;
  submittingId = approvalId;
  window.renderActivity();
  try {
    await window.__TAURI_INTERNALS__.invoke('desktop_overlay_decision', { id: approvalId, decision });
  } catch {
    if (window.atomicDesktopActivity?.[2] === approvalId) {
      submittingId = null;
      window.renderActivity();
      feedback.textContent = 'Could not send. Use the approval dialog in Atomic Chat or try again.';
    }
  }
}
approveButton.addEventListener('click', () => void decide('approve'));
denyButton.addEventListener('click', () => void decide('deny'));
window.renderActivity();

document.querySelector('h1').addEventListener('mousedown', event => {
  if (event.button !== 0) return;
  event.preventDefault();
  void window.__TAURI_INTERNALS__.invoke('desktop_overlay_drag').catch(() => {
    feedback.textContent = 'Could not move the overlay. Try dragging the title again.';
  });
});
