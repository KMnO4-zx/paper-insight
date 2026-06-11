import importlib.util
import sys
from pathlib import Path


SCRIPT_PATH = Path(__file__).resolve().parent.parent / "scripts" / "build_chi_2026_jsonl.py"
SPEC = importlib.util.spec_from_file_location("build_chi_2026_jsonl", SCRIPT_PATH)
assert SPEC and SPEC.loader
chi = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = chi
SPEC.loader.exec_module(chi)


DBLP_SAMPLE = """<bht key="db/conf/chi/chi2026.bht" title="CHI 2026">
<h2>AI &amp; Data Visualization</h2>
<dblpcites><r style="ee"><inproceedings key="conf/chi/DhanoaLHGSE26" mdate="2026-05-21">
<author>Vaishali Dhanoa</author>
<author>Gabriela Molina León</author>
<title>&#34;Hey Dashboard!&#34;: Supporting Voice, Text, and Pointing Modalities in Dashboard Onboarding using Large Language Models.</title>
<pages>1:1-1:15</pages>
<year>2026</year>
<booktitle>CHI</booktitle>
<ee>https://doi.org/10.1145/3772318.3791766</ee>
<crossref>conf/chi/2026</crossref>
</inproceedings></r></dblpcites>
</bht>"""


def test_parse_dblp_chi_2026_paper():
    papers = chi.parse_dblp_chi_2026(DBLP_SAMPLE)

    assert len(papers) == 1
    assert papers[0].id == "chi2026-3772318-3791766"
    assert papers[0].doi == "10.1145/3772318.3791766"
    assert papers[0].primary_area == "AI & Data Visualization"
    assert papers[0].authors == ["Vaishali Dhanoa", "Gabriela Molina León"]


def test_openalex_abstract_and_jsonl_record_shape():
    openalex_item = {
        "title": "A Better Title",
        "abstract_inverted_index": {"Hello": [0], "CHI": [1], "world.": [2]},
        "keywords": [{"display_name": "Dashboard"}, {"display_name": "dashboard"}],
        "locations": [{"pdf_url": "https://arxiv.org/pdf/2510.12386"}],
    }
    paper = chi.parse_dblp_chi_2026(DBLP_SAMPLE)[0]

    record = chi.build_jsonl_record(paper, openalex_item)

    assert record["id"] == "chi2026-3772318-3791766"
    assert record["content"]["title"]["value"] == "A Better Title"
    assert record["content"]["abstract"]["value"] == "Hello CHI world."
    assert record["content"]["keywords"]["value"] == ["Dashboard", "AI & Data Visualization"]
    assert record["content"]["venue"]["value"] == "CHI 2026"
    assert record["content"]["pdf"]["value"] == "https://arxiv.org/pdf/2510.12386"
