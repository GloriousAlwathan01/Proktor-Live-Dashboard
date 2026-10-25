(function () {
  'use strict';

  /* =====================================================================
   * DATA SISWA (Nama & Foto)
   * Ubah nama dan masukkan link/path foto di sini.
   * Kalau foto kosong (""), otomatis bakal nampilkan ikon profil bawaan.
   * Contoh foto lokal: photo: "foto/ahmad.jpg"
   * ===================================================================== */
  var STUDENTS_DATA = [
    { name: "Pazmar Azhari", photo: "img/azhari.png" },
    { name: "Irsan Haposan", photo: "img/irsan.png" },
    { name: "Darma Hafidz S", photo: "img/hafidz.png" },
    { name: "Nirwana Andre S", photo: "img/andre.png" },
    { name: "Basaruddin", photo: "img/bashar.png" },
    { name: "Keysa Ivana J", photo: "img/keysa.png" },
    { name: "Barkah Evan", photo: "img/evan.png" },
    { name: "Husnul Puadi", photo: "img/husnul.png" },
    { name: "Rizky Aditya H", photo: "img/rizki.png" }
  ];

  /* =====================================================================
   * KONFIGURASI FIREBASE
   * ===================================================================== */
  var FIREBASE_CONFIG = {
  apiKey: "AIzaSyAIW6HZPgOm1zJSr_VLrx-cgE9XnsR4GSk",
  authDomain: "tka-liveboard.firebaseapp.com",
  databaseURL: "https://tka-liveboard-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "tka-liveboard",
  storageBucket: "tka-liveboard.firebasestorage.app",
  messagingSenderId: "891708262712",
  appId: "1:891708262712:web:1429283b58f5624fca99cd"
};


  var DB_ROOT = 'proctor';        
  var DEFAULT_ROOM = 'kelas-1';   

  /* ---------- Mode & Room (dari URL) ---------- */
  var params   = new URLSearchParams(window.location.search);
  var MODE     = params.get('mode') === 'tv' ? 'tv' : 'admin';
  var IS_ADMIN = MODE === 'admin';
  var ROOM     = (params.get('room') || DEFAULT_ROOM).replace(/[.#$\[\]\/]/g, '-');

  document.body.classList.add('mode-' + MODE);

  /* ---------- Konstanta ---------- */
  var DURATION_MS = 15 * 60 * 1000;
  var WARNING_SEC = 119;          
  var STUDENT_COUNT = 9;

  var STATUSES = [
    { key: 'idle',   label: 'Belum Mengerjakan' },
    { key: 'active', label: 'Sedang Mengerjakan' },
    { key: 'done',   label: 'Sudah Selesai' }
  ];

  var PILL_LABELS = { idle: 'Siap', running: 'Berjalan', paused: 'Dijeda', expired: 'Waktu Habis' };
  var SYNC_LABELS = { local: 'Mode Lokal', connecting: 'Menghubungkan…', online: 'Tersinkron', offline: 'Terputus', error: 'Gagal Terhubung' };

  var ICON_USER  = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="8" r="4.2"/><path d="M3.5 21c0-4.6 3.8-7.5 8.5-7.5s8.5 2.9 8.5 7.5z"/></svg>';
  var ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  var ICON_PLAY  = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.8v14.4a1 1 0 0 0 1.5.86l12-7.2a1 1 0 0 0 0-1.72l-12-7.2A1 1 0 0 0 7 4.8z"/></svg>';
  var ICON_PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="5.5" y="4" width="4.5" height="16" rx="1.2"/><rect x="14" y="4" width="4.5" height="16" rx="1.2"/></svg>';

  /* ---------- Elemen ---------- */
  var tokenEl   = document.getElementById('token');
  var timerEl   = document.getElementById('timer');
  var pillEl    = document.getElementById('statePill');
  var gridEl    = document.getElementById('grid');
  var overlayEl = document.getElementById('overlay');
  var inputEl   = document.getElementById('tokenInput');
  var adminBar  = document.getElementById('adminBar');
  var btnToken  = document.getElementById('btnToken');
  var btnToggle = document.getElementById('btnToggle');
  var btnReset  = document.getElementById('btnReset');
  var btnSave   = document.getElementById('btnSave');
  var btnCancel = document.getElementById('btnCancel');

  /* ---------- State ---------- */
  var raw = {};                   
  var state = normalize(null);
  var serverOffset = 0;           
  var roomRef = null;
  var modalOpen = false;
  var resetArmed = false;
  var resetTimeout = null;
  var lastTokenShown = null;
  var syncHadError = false;

  function serverNow() { return Date.now() + serverOffset; }

  function normalize(v) {
    v = v || {};
    var t = v.timer || {};
    var status = ['idle', 'running', 'paused'].indexOf(t.status) > -1 ? t.status : 'idle';
    var endAt = typeof t.endAt === 'number' ? t.endAt : null;
    var remainingMs = typeof t.remainingMs === 'number' ? t.remainingMs : DURATION_MS;
    if (status === 'running' && endAt === null) status = 'idle';

    var students = [];
    for (var i = 0; i < STUDENT_COUNT; i++) {
      var n = parseInt(v.students ? v.students[i] : 0, 10);
      students.push(n >= 0 && n < STATUSES.length ? n : 0);
    }

    return {
      token: typeof v.token === 'string' ? v.token : '',
      timer: { status: status, endAt: endAt, remainingMs: remainingMs },
      students: students
    };
  }

  /* ---------- Sinkronisasi (Firebase) ---------- */
  function firebaseConfigured() {
    var c = FIREBASE_CONFIG;
    return !!(c.apiKey && c.databaseURL) && !/YOUR_/.test(c.apiKey + c.databaseURL + c.projectId);
  }

  function setSync(key) {
    var els = document.querySelectorAll('.sync');
    for (var i = 0; i < els.length; i++) {
      els[i].dataset.state = key;
      els[i].querySelector('.lbl').textContent = SYNC_LABELS[key];
    }
  }

  function initSync() {
    if (!firebaseConfigured()) { setSync('local'); return; }
    if (typeof firebase === 'undefined') { setSync('error'); return; }

    try {
      firebase.initializeApp(FIREBASE_CONFIG);
      var db = firebase.database();
      roomRef = db.ref(DB_ROOT + '/' + ROOM);
      setSync('connecting');

      db.ref('.info/serverTimeOffset').on('value', function (snap) {
        serverOffset = snap.val() || 0;
        renderAll();
      });

      db.ref('.info/connected').on('value', function (snap) {
        if (snap.val() === true) { if (!syncHadError) setSync('online'); }
        else setSync('offline');
      });

      roomRef.on('value', function (snap) {
        syncHadError = false;
        state = normalize(snap.val());
        renderAll();
      }, function () {
        syncHadError = true;
        setSync('error');
      });
    } catch (err) {
      console.error('Firebase gagal diinisialisasi:', err);
      roomRef = null;
      setSync('error');
    }
  }

  function setPath(obj, path, val) {
    var parts = path.split('/');
    var o = obj;
    for (var i = 0; i < parts.length - 1; i++) {
      if (typeof o[parts[i]] !== 'object' || o[parts[i]] === null) o[parts[i]] = {};
      o = o[parts[i]];
    }
    o[parts[parts.length - 1]] = val;
  }

  function commit(patch) {
    if (!IS_ADMIN) return;
    if (roomRef) {
      roomRef.update(patch).catch(function () { syncHadError = true; setSync('error'); });
    } else {
      for (var k in patch) setPath(raw, k, patch[k]);
      state = normalize(raw);
      renderAll();
    }
  }

  /* ---------- Helper Tampilan ---------- */
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function setText(el, txt) { if (el.textContent !== txt) el.textContent = txt; }

  function remainingMs() {
    var t = state.timer;
    return t.status === 'running' ? Math.max(0, t.endAt - serverNow()) : t.remainingMs;
  }
  function isExpired() {
    return state.timer.status === 'running' && state.timer.endAt - serverNow() <= 0;
  }

  /* ---------- Render ---------- */
  function renderToken() {
    var expired = isExpired();
    var text = expired ? 'KEDALUWARSA' : (state.token || '-----');

    if (text !== lastTokenShown) {
      var first = lastTokenShown === null;
      tokenEl.textContent = text;
      tokenEl.style.setProperty('--len', Math.max(text.length, 5));
      if (!first) {
        tokenEl.classList.remove('pop');
        void tokenEl.offsetWidth;
        tokenEl.classList.add('pop');
      }
      lastTokenShown = text;
    }
    tokenEl.classList.toggle('expired', expired);
    tokenEl.classList.toggle('idle', !expired && !state.token);
  }

  function renderTimer() {
    var expired = isExpired();
    var sec = Math.ceil(remainingMs() / 1000);
    var status = state.timer.status;

    setText(timerEl, pad(Math.floor(sec / 60)) + ':' + pad(sec % 60));
    timerEl.classList.toggle('warning', sec > 0 && sec <= WARNING_SEC && status !== 'idle');
    timerEl.classList.toggle('running', status === 'running' && !expired);
    timerEl.classList.toggle('expired', expired);

    var pill = expired ? 'expired' : status;
    pillEl.dataset.state = pill;
    setText(pillEl.querySelector('.lbl'), PILL_LABELS[pill]);
  }

  var lastToggleKey = '';
  function renderControls() {
    if (!IS_ADMIN) return;
    var expired = isExpired();
    var status = state.timer.status;

    var key, label, icon;
    if (status === 'running' && !expired) { key = 'pause';  label = 'Jeda Timer'; icon = ICON_PAUSE; }
    else if (status === 'paused')         { key = 'resume'; label = 'Lanjutkan';  icon = ICON_PLAY; }
    else                                  { key = 'start';  label = 'Mulai Timer'; icon = ICON_PLAY; }

    if (key !== lastToggleKey) {
      btnToggle.querySelector('.ico').innerHTML = icon;
      btnToggle.querySelector('.txt').textContent = label;
      lastToggleKey = key;
    }
    btnToggle.disabled = expired;

    setText(btnReset.querySelector('.txt'), resetArmed ? 'Klik lagi untuk reset' : 'Reset Timer');
    btnReset.classList.toggle('armed', resetArmed);
  }

  function renderStudents() {
    var cards = gridEl.children;
    for (var i = 0; i < cards.length; i++) {
      var n = state.students[i];
      cards[i].dataset.index = n;
      cards[i].dataset.status = STATUSES[n].key;
      setText(cards[i].querySelector('.text'), STATUSES[n].label);
    }
  }

  function renderLive() { renderToken(); renderTimer(); renderControls(); }
  function renderAll()  { renderLive(); renderStudents(); }

  /* ---------- Aksi Admin ---------- */
  function applyToken(value) {
    commit({
      'token': value,
      'timer/status': 'running',
      'timer/endAt': serverNow() + DURATION_MS,
      'timer/remainingMs': DURATION_MS
    });
  }

  function toggleTimer() {
    var t = state.timer;
    if (!state.token) { openModal(); return; }

    if (t.status === 'running') {
      var rem = Math.max(0, t.endAt - serverNow());
      if (rem <= 0) return;
      commit({ 'timer/status': 'paused', 'timer/remainingMs': rem, 'timer/endAt': null });
    } else {
      var left = t.remainingMs > 0 ? t.remainingMs : DURATION_MS;
      commit({ 'timer/status': 'running', 'timer/endAt': serverNow() + left, 'timer/remainingMs': left });
    }
  }

  function resetTimer() {
    var status = state.timer.status;
    var needsConfirm = status === 'paused' || (status === 'running' && !isExpired());

    if (needsConfirm && !resetArmed) {
      resetArmed = true;
      renderControls();
      resetTimeout = setTimeout(function () { resetArmed = false; renderControls(); }, 3000);
      return;
    }
    clearTimeout(resetTimeout);
    resetArmed = false;
    commit({ 'timer/status': 'idle', 'timer/remainingMs': DURATION_MS, 'timer/endAt': null });
  }

  function cycleStudent(i) {
    var patch = {};
    patch['students/' + i] = (state.students[i] + 1) % STATUSES.length;
    commit(patch);
  }

  /* ---------- Modal ---------- */
  function openModal() {
    modalOpen = true;
    inputEl.value = '';
    inputEl.classList.remove('shake');
    overlayEl.classList.add('show');
    overlayEl.setAttribute('aria-hidden', 'false');
    setTimeout(function () { inputEl.focus(); }, 50);
  }

  function closeModal() {
    modalOpen = false;
    overlayEl.classList.remove('show');
    overlayEl.setAttribute('aria-hidden', 'true');
    inputEl.blur();
  }

  function submitToken() {
    var value = inputEl.value.replace(/\s+/g, '').toUpperCase();
    if (!value) {
      inputEl.classList.remove('shake');
      void inputEl.offsetWidth;
      inputEl.classList.add('shake');
      return;
    }
    closeModal();
    applyToken(value);
  }

  /* ---------- Siswa: Bangun Kartu Dinamis ---------- */
  function buildStudents() {
    var html = '';
    for (var i = 0; i < STUDENT_COUNT; i++) {
      var student = STUDENTS_DATA[i] || { name: 'Siswa ' + (i + 1), photo: '' };
      
      var avatarHtml = student.photo 
        ? '<img src="' + student.photo + '" alt="' + student.name + '" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">' 
        : ICON_USER;

      html +=
        '<div class="card"' + (IS_ADMIN ? ' role="button"' : '') + ' data-status="idle" data-index="0">' +
          '<div class="tick">' + ICON_CHECK + '</div>' +
          '<div class="avatar">' + avatarHtml + '</div>' +
          '<div class="name">' + student.name + '</div>' +
          '<div class="badge"><span class="dot"></span><span class="text">' + STATUSES[0].label + '</span></div>' +
        '</div>';
    }
    gridEl.innerHTML = html;
  }

  /* ---------- Full Screen Helper ---------- */
  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(function (err) {
        console.error('Gagal Fullscreen:', err.message);
      });
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
  }

  /* ---------- Init ---------- */
  buildStudents();

  if (IS_ADMIN) {
    var tvUrl = new URL(window.location.href);
    tvUrl.searchParams.set('mode', 'tv');
    document.getElementById('tvLink').href = tvUrl.toString();

    gridEl.addEventListener('click', function (e) {
      var card = e.target.closest('.card');
      if (!card) return;
      cycleStudent(Array.prototype.indexOf.call(gridEl.children, card));
    });

    btnToken.addEventListener('click',  function () { btnToken.blur();  openModal(); });
    btnToggle.addEventListener('click', function () { btnToggle.blur(); toggleTimer(); });
    btnReset.addEventListener('click',  function () { btnReset.blur();  resetTimer(); });
    btnSave.addEventListener('click', submitToken);
    btnCancel.addEventListener('click', closeModal);

    overlayEl.addEventListener('mousedown', function (e) {
      if (e.target === overlayEl) closeModal();
    });

    inputEl.addEventListener('input', function () {
      inputEl.value = inputEl.value.replace(/\s+/g, '').toUpperCase();
      inputEl.classList.remove('shake');
    });

    document.addEventListener('keydown', function (e) {
      if (e.repeat) return;
      if (modalOpen) {
        if (e.key === 'Enter')       { e.preventDefault(); submitToken(); }
        else if (e.key === 'Escape') { e.preventDefault(); closeModal(); }
        return;
      }
      if (e.target.closest && e.target.closest('button, a, input')) return;
      if (e.code === 'Space' || e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        openModal();
      }
    });
  } else {
    adminBar.remove();
    overlayEl.remove();
  }

  // Event listener untuk Fullscreen (Tombol 'F' atau Double Click)
  document.addEventListener('keydown', function (e) {
    if ((e.key === 'f' || e.key === 'F') && !modalOpen) {
      toggleFullscreen();
    }
  });

  document.addEventListener('dblclick', function () {
    toggleFullscreen();
  });

  setSync(firebaseConfigured() ? 'connecting' : 'local');
  renderAll();
  initSync();
  setInterval(renderLive, 250);
})();

/* =====================================================================
 * KODE BARU — WELCOME SCREEN, AUDIO SAMBUTAN & TRANSISI KE DASHBOARD
 * Berdiri sendiri (IIFE terpisah): tidak menyentuh variabel, ID, maupun
 * logika Firebase di atas. Sinkronisasi tetap berjalan di latar belakang
 * selama Welcome Screen tampil.
 * ===================================================================== */
(function () {
  'use strict';
 
  var FADE_MS = 600;                 // harus sama dengan durasi transition di style.css
  var AUTOPLAY_ON_ADMIN = false;     // true = laptop admin juga mencoba autoplay (default: hanya TV)
 
  var IS_TV = new URLSearchParams(window.location.search).get('mode') === 'tv';
 
  var welcomeEl   = document.getElementById('welcomeScreen');
  var dashboardEl = document.getElementById('dashboard');
  var audioEl     = document.getElementById('welcomeAudio');
  var btnAudio    = document.getElementById('btnPlayAudio');
  var btnStart    = document.getElementById('btnStartDashboard');
  var hintEl      = document.getElementById('audioHint');
 
  var starting = false;
 
  /* ---------- Audio ---------- */
  function showHint(text) {
    if (text) { hintEl.textContent = text; hintEl.hidden = false; }
    else      { hintEl.hidden = true; }
  }
 
  function playAudio() {
    var p = audioEl.play();
    if (p && typeof p.catch === 'function') {
      p.catch(function (err) {
        if (err && err.name === 'NotAllowedError') {
          // Autoplay diblokir browser → arahkan proktor menekan tombol
          btnAudio.classList.add('attention');
          showHint('Browser memblokir putar otomatis. Tekan “Play Suara” untuk memulai.');
        }
      });
    }
  }
 
  function pauseAudio() {
    audioEl.pause();
  }
 
  // UI tombol mengikuti status audio yang sebenarnya
  audioEl.addEventListener('play', function () {
    btnAudio.textContent = '⏸ Jeda Suara';
    btnAudio.classList.remove('attention');
    showHint('');
  });
  audioEl.addEventListener('pause', function () { btnAudio.textContent = '🔊 Play Suara'; });
  audioEl.addEventListener('ended', function () { btnAudio.textContent = '🔊 Putar Ulang'; });
  audioEl.addEventListener('error', function () {
    btnAudio.disabled = true;
    btnAudio.classList.remove('attention');
    showHint('File suara-sambutan.mp3 tidak ditemukan. Letakkan di folder yang sama dengan index.html.');
  });
 
  btnAudio.addEventListener('click', function () {
    if (audioEl.paused) playAudio(); else pauseAudio();
  });
 
  /* ---------- Transisi: Welcome Screen → Dashboard ---------- */
  function startDashboard() {
    if (starting) return;
    starting = true;
 
    // 1) Hentikan audio
    audioEl.pause();
    audioEl.currentTime = 0;
    btnStart.blur();
 
    // 2) Fade-out Welcome Screen
    welcomeEl.classList.add('fade-out');
 
    // 3) Setelah fade selesai: sembunyikan welcome, tampilkan dashboard dengan fade-in
    setTimeout(function () {
      welcomeEl.classList.add('is-hidden');
 
      dashboardEl.classList.add('fade-in-start');     // opacity 0
      dashboardEl.classList.remove('is-hidden');      // display: block
      void dashboardEl.offsetWidth;                   // paksa reflow agar transisi terpicu
      dashboardEl.classList.remove('fade-in-start');  // opacity → 1 (fade-in)
 
      document.body.classList.remove('welcome-active');
    }, FADE_MS);
  }
 
  btnStart.addEventListener('click', startDashboard);
 
  /* ---------- Cegah pintasan Spasi/Enter dashboard lama saat welcome tampil ----------
   * Listener fase-capture ini berjalan lebih dulu dan menghentikan event sebelum sampai
   * ke handler lama (yang membuka modal token). Aktivasi tombol lewat Enter/Spasi tetap
   * jalan karena itu aksi bawaan browser, bukan bagian dari propagasi.                */
  document.addEventListener('keydown', function (e) {
    if (document.body.classList.contains('welcome-active')) e.stopPropagation();
  }, true);
 
  /* ---------- Init ---------- */
  btnStart.focus();                                  // Enter langsung bisa memulai
  if (IS_TV || AUTOPLAY_ON_ADMIN) playAudio();       // coba autoplay (bisa diblokir browser)
})();
/* ======================= AKHIR KODE BARU ======================= */