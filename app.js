import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, addDoc, deleteDoc, doc, getDocs, writeBatch, query, orderBy, onSnapshot, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig, adminEmail } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const GENRES = ["힙합", "팝", "발라드", "재즈", "록", "R&B", "하우스", "테크노", "클래식"];

let uid = null, isAdmin = false, tab = "album", genre = "전체", posts = [];
const open = new Set(), unsubs = {};
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const stars = (n) => { const r = Math.round(Number(n) * 10) / 10; return `<span class="st" style="--p:${r * 20}%">★★★★★</span><b>${r.toFixed(1)}</b>`; };
const when = (ts) => (ts?.toDate ? ts.toDate().toLocaleString("ko-KR") : "방금 전");
const savedNick = () => localStorage.getItem("nick") || "";

/* 로그인: 평소엔 익명, 관리자는 구글 로그인 */
onAuthStateChanged(auth, (u) => {
  if (!u) { signInAnonymously(auth).catch(() => alert("로그인 실패: Firebase 콘솔에서 '익명' 로그인을 켰는지 확인하세요.")); return; }
  uid = u.uid;
  isAdmin = !u.isAnonymous && u.emailVerified && (u.email || "").toLowerCase() === adminEmail.toLowerCase();
  $("#authBtn").textContent = u.isAnonymous ? "🔑 관리자 로그인" : "로그아웃";
  $("#who").textContent = isAdmin ? "👑 관리자 모드" : "";
  render();
});

$("#authBtn").onclick = () => {
  if (auth.currentUser && !auth.currentUser.isAnonymous) signOut(auth);
  else signInWithPopup(auth, new GoogleAuthProvider()).catch((e) => alert("로그인 실패: " + e.message));
};

/* 게시물 실시간 구독 */
onSnapshot(
  query(collection(db, "posts"), orderBy("createdAt", "desc")),
  (snap) => { posts = snap.docs.map((d) => ({ id: d.id, ...d.data() })); render(); },
  (err) => { $("#list").innerHTML = `<p class="empty">불러오기 실패: ${esc(err.message)}</p>`; }
);

/* 장르 칸 (글 개수 표시) */
function renderChips() {
  const base = posts.filter((p) => p.type === tab);
  $("#genres").innerHTML = ["전체", ...GENRES].map((g) => {
    const n = g === "전체" ? base.length : base.filter((p) => p.genre === g).length;
    return `<button class="chip${g === genre ? " on" : ""}" data-g="${esc(g)}">${esc(g)}<i>${n}</i></button>`;
  }).join("");
}

/* 화면 그리기 */
function render() {
  renderChips();
  const list = posts.filter((p) => p.type === tab && (genre === "전체" || p.genre === genre));
  const label = (genre === "전체" ? "" : genre + " ") + (tab === "album" ? "앨범" : "곡");
  $("#list").innerHTML = list.length ? list.map(card).join("") : `<p class="empty">아직 ${esc(label)} 게시물이 없어요. 첫 글을 남겨보세요!</p>`;
  open.forEach(openComments);
}

function card(p) {
  const album = p.type === "album";
  const cover = /^https?:\/\//.test(p.cover) ? `<img class="cover" src="${esc(p.cover)}" alt="앨범 커버" loading="lazy">` : "";
  return `
  <article class="card" data-id="${p.id}">
    ${album ? cover : ""}
    <div class="body">
      <h3>${esc(p.title)} <small>${esc(p.artist)}</small>${p.genre ? `<span class="tag">${esc(p.genre)}</span>` : ""}</h3>
      <div class="stars">${stars(p.rating)}</div>
      ${album ? `<p class="tracks"><span class="best">👍 베스트 트랙: ${esc(p.best || "-")}</span><span class="worst">👎 워스트 트랙: ${esc(p.worst || "-")}</span></p>` : ""}
      <p class="review">${esc(p.review)}</p>
      <div class="meta">
        <span>${esc(p.nick)} · ${when(p.createdAt)}</span>
        <button data-act="toggle">💬 댓글</button>
        ${isAdmin || p.uid === uid ? '<button data-act="del">삭제</button>' : ""}
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
    const owner = posts.find((p) => p.id === id)?.uid;
    box.querySelector("ul").innerHTML = snap.docs.map((d) => {
      const c = d.data();
      const can = uid && (isAdmin || c.uid === uid || owner === uid);
      return `<li><b>${esc(c.nick)}</b> ${esc(c.text)} <small>${when(c.createdAt)}</small>${can ? ` <button data-act="cdel" data-cid="${d.id}">×</button>` : ""}</li>`;
    }).join("") || '<li class="empty">첫 댓글을 남겨보세요.</li>';
  });
}

/* 글 삭제: 댓글까지 함께 삭제 (실패하면 글만 삭제) */
async function removePost(id) {
  try {
    const cs = await getDocs(collection(db, "posts", id, "comments"));
    const b = writeBatch(db);
    cs.forEach((d) => b.delete(d.ref));
    b.delete(doc(db, "posts", id));
    await b.commit();
  } catch { await deleteDoc(doc(db, "posts", id)); }
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
    } else if (act === "del" && confirm("이 게시물과 댓글을 모두 삭제할까요?")) {
      await removePost(id);
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
  const rating = Math.round(Number(v.rating) * 10) / 10;
  if (!GENRES.includes(v.genre)) return alert("장르를 선택해주세요.");
  if (!(rating >= 0.1 && rating <= 5)) return alert("별점은 0.1 ~ 5.0 사이로 입력해주세요.");
  try {
    await addDoc(collection(db, "posts"), {
      type: tab,
      genre: v.genre,
      title: v.title.trim(),
      artist: v.artist.trim(),
      cover: album && /^https?:\/\//.test(cover) ? cover : "",
      best: album ? (v.best || "").trim() : "",
      worst: album ? (v.worst || "").trim() : "",
      rating,
      review: v.review.trim(),
      nick: v.nick.trim(),
      uid,
      createdAt: serverTimestamp()
    });
    localStorage.setItem("nick", v.nick.trim());
    f.reset();
    f.elements.nick.value = savedNick();
    f.elements.genre.value = genre === "전체" ? "" : genre;
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

/* 장르 칸 클릭 */
$("#genres").addEventListener("click", (e) => {
  const b = e.target.closest(".chip");
  if (!b) return;
  genre = b.dataset.g;
  if (genre !== "전체") $("#postForm [name=genre]").value = genre;
  render();
});

/* 초기화 */
$("#postForm [name=genre]").innerHTML = '<option value="">장르 선택</option>' + GENRES.map((g) => `<option value="${esc(g)}">${esc(g)}</option>`).join("");
$("#postForm [name=nick]").value = savedNick();
setTab("album");
