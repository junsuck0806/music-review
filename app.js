import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, addDoc, deleteDoc, doc, query, orderBy, onSnapshot, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let uid = null, tab = "album", posts = [];
const open = new Set(), unsubs = {};
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const stars = (n) => "★".repeat(n) + "☆".repeat(5 - n);
const when = (ts) => (ts?.toDate ? ts.toDate().toLocaleString("ko-KR") : "방금 전");
const savedNick = () => localStorage.getItem("nick") || "";

/* 익명 로그인: 내가 쓴 글/댓글만 삭제할 수 있게 해주는 용도 */
onAuthStateChanged(auth, (u) => { uid = u ? u.uid : null; render(); });
signInAnonymously(auth).catch(() => alert("로그인 실패: Firebase 콘솔에서 '익명' 로그인을 켰는지 확인하세요."));

/* 게시물 실시간 구독 */
onSnapshot(
  query(collection(db, "posts"), orderBy("createdAt", "desc")),
  (snap) => { posts = snap.docs.map((d) => ({ id: d.id, ...d.data() })); render(); },
  (err) => { $("#list").innerHTML = `<p class="empty">불러오기 실패: ${esc(err.message)}</p>`; }
);

/* 화면 그리기 */
function render() {
  const list = posts.filter((p) => p.type === tab);
  $("#list").innerHTML = list.length ? list.map(card).join("") : '<p class="empty">아직 게시물이 없어요. 첫 글을 남겨보세요!</p>';
  open.forEach(openComments);
}

function card(p) {
  const album = p.type === "album";
  const cover = /^https?:\/\//.test(p.cover) ? `<img class="cover" src="${esc(p.cover)}" alt="앨범 커버" loading="lazy">` : "";
  return `
  <article class="card" data-id="${p.id}">
    ${album ? cover : ""}
    <div class="body">
      <h3>${esc(p.title)} <small>${esc(p.artist)}</small></h3>
      <div class="stars">${stars(p.rating)}</div>
      ${album ? `<p class="tracks"><span class="best">👍 베스트 트랙: ${esc(p.best || "-")}</span><span class="worst">👎 워스트 트랙: ${esc(p.worst || "-")}</span></p>` : ""}
      <p class="review">${esc(p.review)}</p>
      <div class="meta">
        <span>${esc(p.nick)} · ${when(p.createdAt)}</span>
        <button data-act="toggle">💬 댓글</button>
        ${p.uid === uid ? '<button data-act="del">삭제</button>' : ""}
      </div>
      <div class="comments" hidden>
        <ul></ul>
        <form class="cform">
          <input name="nick" placeholder="닉네임" maxlength="20" value="${esc(savedNick())}" required>
          <input name="text" placeholder="댓글을 입력하세요" maxlength="500" required>
          <button>등록</button>
        </form>
      </div>
    </div>
  </article>`;
}

/* 댓글 실시간 구독 */
function openComments(id) {
  const box = document.querySelector(`.card[data-id="${id}"] .comments`);
  if (!box) return;
  box.hidden = false;
  unsubs[id]?.();
  unsubs[id] = onSnapshot(query(collection(db, "posts", id, "comments"), orderBy("createdAt", "asc")), (snap) => {
    box.querySelector("ul").innerHTML = snap.docs.map((d) => {
      const c = d.data();
      return `<li><b>${esc(c.nick)}</b> ${esc(c.text)} <small>${when(c.createdAt)}</small>${c.uid === uid ? ` <button data-act="cdel" data-cid="${d.id}">×</button>` : ""}</li>`;
    }).join("") || '<li class="empty">첫 댓글을 남겨보세요.</li>';
  });
}

/* 클릭: 댓글 열기/닫기, 글 삭제, 댓글 삭제 */
$("#list").addEventListener("click", async (e) => {
  const act = e.target.dataset.act;
  if (!act) return;
  const cardEl = e.target.closest(".card"), id = cardEl.dataset.id;
  try {
    if (act === "toggle") {
      if (open.delete(id)) { unsubs[id]?.(); delete unsubs[id]; cardEl.querySelector(".comments").hidden = true; }
      else { open.add(id); openComments(id); }
    } else if (act === "del" && confirm("이 게시물을 삭제할까요?")) {
      await deleteDoc(doc(db, "posts", id));
    } else if (act === "cdel") {
      await deleteDoc(doc(db, "posts", id, "comments", e.target.dataset.cid));
    }
  } catch (err) { alert("실패: " + err.message); }
});

/* 댓글 등록 */
$("#list").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!uid) return alert("로그인 중이에요. 잠시 후 다시 시도해주세요.");
  const f = e.target, id = f.closest(".card").dataset.id;
  const v = Object.fromEntries(new FormData(f));
  try {
    await addDoc(collection(db, "posts", id, "comments"), {
      nick: v.nick.trim(), text: v.text.trim(), uid, createdAt: serverTimestamp()
    });
    localStorage.setItem("nick", v.nick.trim());
    f.elements.text.value = "";
  } catch (err) { alert("댓글 등록 실패: " + err.message); }
});

/* 게시물 등록 */
$("#postForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!uid) return alert("로그인 중이에요. 잠시 후 다시 시도해주세요.");
  const f = e.target, v = Object.fromEntries(new FormData(f)), album = tab === "album";
  const cover = (v.cover || "").trim();
  try {
    await addDoc(collection(db, "posts"), {
      type: tab,
      title: v.title.trim(),
      artist: v.artist.trim(),
      cover: album && /^https?:\/\//.test(cover) ? cover : "",
      best: album ? (v.best || "").trim() : "",
      worst: album ? (v.worst || "").trim() : "",
      rating: Number(v.rating),
      review: v.review.trim(),
      nick: v.nick.trim(),
      uid,
      createdAt: serverTimestamp()
    });
    localStorage.setItem("nick", v.nick.trim());
    f.reset();
    f.elements.nick.value = savedNick();
  } catch (err) { alert("등록 실패: " + err.message); }
});

/* 탭 전환 (앨범 / 곡) */
function setTab(t) {
  tab = t;
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("on", b.dataset.tab === t));
  document.querySelectorAll(".album-only").forEach((el) => (el.hidden = t !== "album"));
  $("#formTitle").textContent = t === "album" ? "💿 앨범 평가 올리기" : "🎵 곡 평가 올리기";
  $("#postForm [name=title]").placeholder = t === "album" ? "앨범명" : "곡명";
  render();
}
document.querySelectorAll(".tab").forEach((b) => (b.onclick = () => setTab(b.dataset.tab)));
$("#postForm [name=nick]").value = savedNick();
setTab("album");
