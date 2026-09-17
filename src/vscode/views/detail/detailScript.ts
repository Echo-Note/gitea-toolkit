/**
 * 详情面板的客户端脚本。
 *
 * 约定：
 *   - 只做渲染与消息上报；所有写操作（评论 / 关闭 / 合并 / 评审）都由扩展宿主调用 Gitea API，
 *     Webview 中不接触访问令牌
 *   - Gitea 服务端渲染出的 HTML（正文 / 评论）直接插入；纯文本字段一律先转义
 *   - 草稿通过 `vscode.setState` 持久化，面板被隐藏后恢复不丢失输入
 */
export const DETAIL_SCRIPT = `
(function () {
  var vscode = acquireVsCodeApi();
  var view = null;
  var busy = false;

  function $(id) { return document.getElementById(id); }

  function post(type, payload) {
    vscode.postMessage(Object.assign({ type: type }, payload || {}));
  }

  function esc(value) {
    if (value === null || value === undefined) { return ''; }
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * 生成头像元素。Gitea 未提供头像地址（或地址失效）时降级为纯色圆点，
   * 避免出现浏览器默认的破图图标。
   */
  function avatarHtml(actor) {
    if (actor && actor.avatar) {
      return '<img class="avatar" src="' + esc(actor.avatar) + '" alt="" />';
    }
    return '<span class="avatar avatar-fallback"></span>';
  }

  /** 隐藏加载失败的头像 / 图片（CSP 禁止内联事件，只能在渲染后统一挂监听）。 */
  function hideBrokenImages() {
    var images = document.querySelectorAll('img');
    for (var i = 0; i < images.length; i++) {
      var image = images[i];
      if (!image.getAttribute('src')) {
        image.style.visibility = 'hidden';
        continue;
      }
      image.addEventListener('error', function () { this.style.visibility = 'hidden'; });
    }
  }

  function badgeHtml() {
    if (view.kind === 'pull' && view.isMerged) { return '<span class="badge merged">已合并</span>'; }
    if (view.isClosed) { return '<span class="badge closed">已关闭</span>'; }
    if (view.isDraft) { return '<span class="badge draft">草稿</span>'; }
    return '<span class="badge open">进行中</span>';
  }

  function renderHeader() {
    var chips = [];
    view.labels.forEach(function (label) {
      chips.push('<span class="chip" style="background:' + esc(label.color) + ';color:' + esc(label.textColor) + '">' + esc(label.name) + '</span>');
    });
    view.assignees.forEach(function (actor) {
      chips.push('<span class="chip chip-actor">@' + esc(actor.login) + '</span>');
    });
    if (view.milestone) {
      chips.push('<span class="chip chip-actor">里程碑：' + esc(view.milestone) + '</span>');
    }

    var prBits = '';
    if (view.kind === 'pull') {
      prBits = '<span class="branch-chip">' + esc(view.headRef || '?') + ' &rarr; ' + esc(view.baseRef || '?') + '</span>' +
        '<span class="stat-add">+' + view.additions + '</span>' +
        '<span class="stat-del">-' + view.deletions + '</span>' +
        '<span>' + view.changedFiles + ' 个文件</span>' +
        (view.mergeable === false ? '<span class="stat-del">存在冲突</span>' : '');
    }

    $('header').innerHTML =
      '<div class="title-row">' +
        '<div class="title"><span class="num">#' + view.number + '</span> ' + esc(view.title) + '</div>' +
        '<div class="header-actions">' +
          '<button class="icon" data-action="refresh" title="刷新">刷新</button>' +
          '<button class="icon" data-action="openExternal" data-url="' + esc(view.htmlUrl) + '" title="在浏览器打开">浏览器</button>' +
        '</div>' +
      '</div>' +
      '<div class="meta-row">' +
        badgeHtml() +
        '<span>@' + esc(view.author.login) + '</span>' +
        '<span>创建于 ' + esc(view.createdAgo) + '</span>' +
        '<span>更新于 ' + esc(view.updatedAgo) + '</span>' +
        prBits +
      '</div>' +
      (chips.length > 0 ? '<div class="chips">' + chips.join('') + '</div>' : '');
    document.title = '#' + view.number + ' ' + view.title;
  }

  function renderBody() {
    $('body-content').innerHTML = view.bodyHtml;
  }

  function renderFiles() {
    if (view.kind !== 'pull' || view.files.length === 0) {
      $('files-section').classList.add('hidden');
      return;
    }
    $('files-table').innerHTML = view.files.map(function (file) {
      return '<tr>' +
        '<td><span class="status-pill">' + esc(file.status) + '</span> <span class="fname">' + esc(file.filename) + '</span></td>' +
        '<td class="fstat"><span class="fa">+' + file.additions + '</span> <span class="fd">-' + file.deletions + '</span></td>' +
      '</tr>';
    }).join('');
    $('files-section').classList.remove('hidden');
  }

  function renderReviews() {
    if (view.kind !== 'pull' || view.reviews.length === 0) {
      $('reviews-section').classList.add('hidden');
      return;
    }
    $('reviews-list').innerHTML = view.reviews.map(function (review) {
      var cls = review.state === 'APPROVED' ? 'approved' : review.state === 'REQUEST_CHANGES' ? 'changes' : '';
      return '<div class="card">' +
        '<div class="card-head">' +
          avatarHtml(review.author) +
          '<strong>@' + esc(review.author.login) + '</strong>' +
          '<span class="state-tag ' + cls + '">' + esc(review.stateText) + '</span>' +
          '<span class="spacer"></span>' +
          '<span class="muted">' + esc(review.submittedAgo) + '</span>' +
        '</div>' +
        '<div class="card-body md">' + review.bodyHtml + '</div>' +
      '</div>';
    }).join('');
    $('reviews-section').classList.remove('hidden');
  }

  function renderComments() {
    $('comments-count').textContent = String(view.comments.length);
    if (view.comments.length === 0) {
      $('comments-list').innerHTML = '<p class="muted">还没有回复，来说点什么吧。</p>';
      return;
    }
    $('comments-list').innerHTML = view.comments.map(function (comment) {
      var permalink = esc(view.htmlUrl) + '#issuecomment-' + comment.id;
      return '<div class="card">' +
        '<div class="card-head">' +
          avatarHtml(comment.author) +
          '<strong>@' + esc(comment.author.login) + '</strong>' +
          '<span class="spacer"></span>' +
          '<a href="' + permalink + '" class="muted">' + esc(comment.createdAgo) + '</a>' +
        '</div>' +
        '<div class="card-body md">' + comment.bodyHtml + '</div>' +
      '</div>';
    }).join('');
  }

  function renderComposer() {
    var parts = ['<button class="primary" data-action="reply">发表评论</button>'];
    if (!view.isClosed) {
      parts.push('<button data-action="replyClose">评论并关闭</button>');
    }
    parts.push('<span class="spacer"></span>');
    parts.push('<span class="hint" id="composer-hint"></span>');
    $('composer-bar').innerHTML = parts.join('');
  }

  function renderActions() {
    var parts = [];
    if (view.kind === 'pull' && !view.isMerged && !view.isClosed) {
      parts.push('<select id="merge-strategy" title="合并方式">' +
        '<option value="merge">merge</option>' +
        '<option value="squash">squash</option>' +
        '<option value="rebase">rebase</option>' +
        '<option value="rebase-merge">rebase-merge</option>' +
      '</select>');
      parts.push('<button data-action="review" data-event="APPROVED">批准</button>');
      parts.push('<button data-action="review" data-event="REQUEST_CHANGES">请求修改</button>');
      parts.push('<button data-action="merge">合并</button>');
      parts.push('<button data-action="checkout">检出分支</button>');
    }
    parts.push(view.isClosed
      ? '<button data-action="state" data-state="open">重新打开</button>'
      : '<button class="danger" data-action="state" data-state="closed">关闭</button>');
    $('action-bar').innerHTML = parts.join('');
  }

  function renderBusy() {
    $('composer-input').disabled = busy;
    var controls = document.querySelectorAll('button, select, textarea');
    for (var i = 0; i < controls.length; i++) { controls[i].disabled = busy; }
    var hint = $('composer-hint');
    if (hint) { hint.textContent = busy ? '处理中…' : 'Ctrl/Cmd + Enter 快速发表'; }
    syncComposerHeight();
  }

  /** 让正文区域底部预留出固定定位回复框的高度，避免内容被遮挡。 */
  function syncComposerHeight() {
    var composer = document.querySelector('.composer');
    if (composer) {
      document.body.style.paddingBottom = (composer.offsetHeight + 28) + 'px';
    }
  }

  function render() {
    if (!view) { return; }
    renderHeader();
    renderBody();
    renderFiles();
    renderReviews();
    renderComments();
    renderComposer();
    renderActions();
    renderBusy();
    hideBrokenImages();
  }

  function persistDraft() { vscode.setState({ draft: $('composer-input').value }); }

  function restoreDraft() {
    var saved = vscode.getState();
    if (saved && typeof saved.draft === 'string') {
      $('composer-input').value = saved.draft;
    }
  }

  function submitReply(closeAfter) {
    var body = $('composer-input').value.trim();
    if (body.length === 0) {
      $('composer-input').focus();
      return;
    }
    post('reply', { body: body, closeAfter: Boolean(closeAfter) });
  }

  function handleAction(action, element) {
    if (action === 'reply') { submitReply(false); return; }
    if (action === 'replyClose') { submitReply(true); return; }
    if (action === 'refresh') { post('refresh'); return; }
    if (action === 'state') { post('setState', { state: element.getAttribute('data-state') }); return; }
    if (action === 'openExternal') {
      var url = element.getAttribute('data-url');
      if (url) { post('openExternal', { url: url }); }
      return;
    }
    if (action === 'review') {
      post('review', { event: element.getAttribute('data-event'), body: $('composer-input').value.trim() });
      return;
    }
    if (action === 'merge') {
      var select = $('merge-strategy');
      post('merge', { strategy: select ? select.value : 'merge', deleteBranch: true });
      return;
    }
    if (action === 'checkout') { post('checkout'); }
  }

  document.addEventListener('click', function (event) {
    var node = event.target;
    if (!node || !node.closest) { return; }

    var actionEl = node.closest('[data-action]');
    if (actionEl) {
      event.preventDefault();
      handleAction(actionEl.getAttribute('data-action'), actionEl);
      return;
    }

    var link = node.closest('a[href]');
    if (link) {
      event.preventDefault();
      post('openExternal', { url: link.href });
    }
  });

  window.addEventListener('resize', syncComposerHeight);
  $('composer-input').addEventListener('input', persistDraft);
  $('composer-input').addEventListener('keydown', function (event) {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      submitReply(false);
    }
  });

  window.addEventListener('message', function (event) {
    var message = event.data || {};
    if (message.type === 'render') {
      view = message.view;
      render();
      restoreDraft();
    } else if (message.type === 'busy') {
      busy = Boolean(message.value);
      renderBusy();
    } else if (message.type === 'clearDraft') {
      $('composer-input').value = '';
      persistDraft();
    } else if (message.type === 'focusComposer') {
      $('composer-input').focus();
    }
  });

  post('ready');
})();
`;
