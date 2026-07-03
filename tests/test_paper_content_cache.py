from pathlib import Path
import json
import sys
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

import utils


def test_cache_round_trip_uses_paper_id_and_metadata(tmp_path, monkeypatch):
    monkeypatch.setattr(
        utils,
        "settings",
        SimpleNamespace(paths=SimpleNamespace(paper_content_cache_dir=str(tmp_path))),
    )

    paper_id = "paper/with:unsafe?chars"
    pdf_url = "https://example.com/paper.pdf"
    content = "cached paper body"

    utils.cache_paper_content(paper_id, pdf_url, content)

    txt_files = list(tmp_path.glob("*.txt"))
    meta_files = list(tmp_path.glob("*.meta.json"))

    assert len(txt_files) == 1
    assert len(meta_files) == 1
    assert utils.has_cached_paper_content(paper_id, pdf_url) is True
    assert utils.get_cached_paper_content(paper_id, pdf_url) == content

    metadata = json.loads(meta_files[0].read_text(encoding="utf-8"))
    assert metadata["paper_id"] == paper_id
    assert metadata["pdf_url"] == pdf_url
    assert metadata["source"] == "jina_reader"


def test_get_or_cache_paper_content_hits_reader_once(tmp_path, monkeypatch):
    monkeypatch.setattr(
        utils,
        "settings",
        SimpleNamespace(paths=SimpleNamespace(paper_content_cache_dir=str(tmp_path))),
    )

    calls: list[str] = []

    def fake_reader(url: str) -> str:
        calls.append(url)
        return "body from reader"

    monkeypatch.setattr(utils, "reader", fake_reader)

    paper_id = "uq6UWRgzMr"
    pdf_url = "https://example.com/uq6UWRgzMr.pdf"

    first = utils.get_or_cache_paper_content(paper_id, pdf_url)
    second = utils.get_or_cache_paper_content(paper_id, pdf_url)

    assert first == "body from reader"
    assert second == "body from reader"
    assert calls == [pdf_url]


def test_get_or_cache_paper_content_falls_back_to_pdf_text_extractor(tmp_path, monkeypatch):
    monkeypatch.setattr(
        utils,
        "settings",
        SimpleNamespace(paths=SimpleNamespace(paper_content_cache_dir=str(tmp_path))),
    )

    reader_calls: list[str] = []
    extractor_calls: list[str] = []

    def fake_reader(url: str) -> str:
        reader_calls.append(url)
        raise utils.ReaderError("Jina Reader 401")

    def fake_extract_pdf_text_from_url(url: str) -> str:
        extractor_calls.append(url)
        return "body from local pdf extraction"

    monkeypatch.setattr(utils, "reader", fake_reader)
    monkeypatch.setattr(utils, "extract_pdf_text_from_url", fake_extract_pdf_text_from_url)

    paper_id = "arxiv:2605.07250"
    pdf_url = "https://arxiv.org/pdf/2605.07250v1"

    content = utils.get_or_cache_paper_content(paper_id, pdf_url)

    assert content == "body from local pdf extraction"
    assert reader_calls == [pdf_url]
    assert extractor_calls == [pdf_url]

    meta_files = list(tmp_path.glob("*.meta.json"))
    assert len(meta_files) == 1
    metadata = json.loads(meta_files[0].read_text(encoding="utf-8"))
    assert metadata["source"] == "pdf_text_extractor"


def test_cache_ignores_blocked_reader_content(tmp_path, monkeypatch):
    monkeypatch.setattr(
        utils,
        "settings",
        SimpleNamespace(paths=SimpleNamespace(paper_content_cache_dir=str(tmp_path))),
    )

    blocked_content = """Title: Just a moment...

    Warning: Target URL returned error 403: Forbidden

    ## Performing security verification
    This website uses a security service to protect against malicious bots.
    """

    utils.cache_paper_content("chi2026-3772318-3791732", "https://dl.acm.org/doi/pdf/10.1145/3772318.3791732", blocked_content)

    assert list(tmp_path.glob("*.txt")) == []
    assert list(tmp_path.glob("*.meta.json")) == []


def test_get_cached_paper_content_ignores_existing_blocked_cache(tmp_path, monkeypatch):
    monkeypatch.setattr(
        utils,
        "settings",
        SimpleNamespace(paths=SimpleNamespace(paper_content_cache_dir=str(tmp_path))),
    )

    paper_id = "chi2026-3772318-3791732"
    pdf_url = "https://dl.acm.org/doi/pdf/10.1145/3772318.3791732"
    content_path, meta_path = utils._get_paper_cache_paths(paper_id)
    content_path.parent.mkdir(parents=True, exist_ok=True)
    content_path.write_text("## Performing security verification\nThis website uses a security service to protect against malicious bots.", encoding="utf-8")
    meta_path.write_text(json.dumps({"paper_id": paper_id, "pdf_url": pdf_url}), encoding="utf-8")

    assert utils.get_cached_paper_content(paper_id, pdf_url) is None


def test_reader_posts_json_payload(monkeypatch):
    class FakeResponse:
        text = "Title: Example Domain\n\nMarkdown Content:\nExample body"

        def raise_for_status(self):
            return None

    calls = []

    def fake_post(url, json=None, headers=None, timeout=None):
        calls.append(
            {
                "url": url,
                "json": json,
                "headers": headers,
                "timeout": timeout,
            }
        )
        return FakeResponse()

    monkeypatch.setattr(utils.requests, "post", fake_post)

    assert utils.reader("https://www.example.com") == FakeResponse.text
    assert calls == [
        {
            "url": "https://r.jina.ai/",
            "json": {"url": "https://www.example.com"},
            "headers": utils._reader_request_headers(),
            "timeout": utils.TIMEOUT,
        }
    ]


def test_reader_rejects_blocked_page(monkeypatch):
    class FakeResponse:
        text = "Title: Just a moment...\n## Performing security verification"

        def raise_for_status(self):
            return None

    def fake_post(url, json=None, headers=None, timeout=None):
        return FakeResponse()

    monkeypatch.setattr(utils.requests, "post", fake_post)

    try:
        utils.reader("https://dl.acm.org/doi/pdf/10.1145/3772318.3791732")
    except utils.ReaderError as exc:
        assert "访问验证" in str(exc)
    else:
        raise AssertionError("reader should reject blocked verification pages")


def test_get_openreview_info_returns_none_on_404(monkeypatch):
    class FakeResponse:
        status_code = 404

    calls = []

    def fake_get(url, headers=None, timeout=None):
        calls.append(url)
        return FakeResponse()

    monkeypatch.setattr(utils.requests, "get", fake_get)

    assert utils.get_openreview_info("chi2026-3772318-3791732") is None
    assert calls == ["https://api2.openreview.net/notes?id=chi2026-3772318-3791732"]
