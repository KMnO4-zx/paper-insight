import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from build_acl_2026_jsonl import build_acl_long_rows


def test_build_acl_long_rows_from_anthology_fragments():
    event_html = """
    <html><body>
    <div id=2026acl-long>
      <div class="d-sm-flex align-items-stretch mb-3">
        <a class="badge" href=https://aclanthology.org/2026.acl-long.1.pdf>pdf</a>
        <span class=d-block><strong><a class=align-middle href=/2026.acl-long.1/>
          <span class=acl-fixed-case>O</span>cto<span class=acl-fixed-case>T</span>ools:
          A Multi-Agent Framework
        </a></strong><br><a href=/people/pan-lu/>Pan Lu</a> | <a href=/people/james-zou/>James Zou</a></span>
      </div>
      <div class="card bg-light mb-2 mb-lg-3 collapse abstract-collapse" id=abstract-2026--acl-long--1>
        <div class="card-body p-3 small">Solving complex reasoning tasks.</div>
      </div>
      <div class="d-sm-flex align-items-stretch mb-3">
        <a class="badge" href=https://aclanthology.org/2026.acl-long.2.pdf>pdf</a>
        <span class=d-block><strong><a class=align-middle href=/2026.acl-long.2/>
          No Reader Left Behind
        </a></strong><br><a href=/people/jimin-jung/>Jimin Jung</a></span>
      </div>
    </div>
    <div id=2026acl-short></div>
    </body></html>
    """
    bib_text = """
@proceedings{acl-2026-long,
  title = "Proceedings",
  url = "https://aclanthology.org/2026.acl-long.0/"
}
@inproceedings{lu-etal-2026-octotools,
  title = "{O}cto{T}ools: A Multi-Agent Framework",
  author = "Lu, Pan and Zou, James",
  url = "https://aclanthology.org/2026.acl-long.1/",
  doi = "10.18653/v1/2026.acl-long.1",
  pages = "1--86"
}
@inproceedings{jung-etal-2026-reader,
  title = "No Reader Left Behind",
  author = "Jung, Jimin",
  url = "https://aclanthology.org/2026.acl-long.2/",
  pages = "87--116"
}
    """

    rows = build_acl_long_rows(event_html, bib_text)

    assert [row["id"] for row in rows] == ["2026.acl-long.1", "2026.acl-long.2"]
    assert rows[0]["content"]["title"]["value"] == "OctoTools: A Multi-Agent Framework"
    assert rows[0]["content"]["abstract"]["value"] == "Solving complex reasoning tasks."
    assert rows[0]["content"]["authors"]["value"] == ["Pan Lu", "James Zou"]
    assert rows[0]["content"]["keywords"]["value"] == []
    assert rows[0]["content"]["venue"]["value"] == "ACL 2026 Long"
    assert rows[0]["acl"]["doi"] == "10.18653/v1/2026.acl-long.1"
    assert rows[1]["content"]["abstract"]["value"] == ""
