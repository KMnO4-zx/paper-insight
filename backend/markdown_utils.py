import re


CODE_SEGMENT_PATTERN = re.compile(r"```[\s\S]*?(?:```|$)|`[^`\n]*`")
SAME_LINE_BLOCK_MATH_PATTERN = re.compile(r"^([ \t]*)\$\$[ \t]*(\S(?:.*?\S)?)[ \t]*\$\$[ \t]*$", re.MULTILINE)


def _mask_code_segments(content: str) -> tuple[str, list[str]]:
    segments: list[str] = []

    def _replace(match: re.Match[str]) -> str:
        token = f"__CODE_SEGMENT_{len(segments)}__"
        segments.append(match.group(0))
        return token

    return CODE_SEGMENT_PATTERN.sub(_replace, content), segments


def _unmask_code_segments(content: str, segments: list[str]) -> str:
    def _replace(match: re.Match[str]) -> str:
        index = int(match.group(1))
        return segments[index] if index < len(segments) else ""

    return re.sub(r"__CODE_SEGMENT_(\d+)__", _replace, content)


def _looks_like_inline_math(expression: str) -> bool:
    value = expression.strip()
    if not value:
        return False
    if re.search(r"\\[A-Za-z]+|[_^{}]", value):
        return True
    if re.search(r"\s", value):
        return False
    if not re.search(r"[A-Za-z]", value) and not re.search(r"[=<>+\-*/]", value):
        return False
    return bool(re.fullmatch(r"[A-Za-z0-9()[\].,:;+\-*/=<>|]+", value))


def _normalize_escaped_inline_math(content: str) -> str:
    def _replace_leading(match: re.Match[str]) -> str:
        expression = match.group(1)
        return f"${expression}$" if _looks_like_inline_math(expression) else match.group(0)

    def _replace_trailing(match: re.Match[str]) -> str:
        expression = match.group(1)
        return f"${expression}$" if _looks_like_inline_math(expression) else match.group(0)

    return re.sub(r"\$([^\n]*?)\\\$", _replace_trailing, re.sub(r"\\\$([^\n]*?)(\\\$|\$)", _replace_leading, content))


def _normalize_bracket_math(content: str) -> str:
    def _replace_block(match: re.Match[str]) -> str:
        expression = match.group(1).strip()
        return f"$$\n{expression}\n$$"

    def _replace_inline(match: re.Match[str]) -> str:
        expression = match.group(1)
        return f"${expression.strip()}$" if _looks_like_inline_math(expression) else match.group(0)

    content = re.sub(r"\\\[\s*([\s\S]+?)\s*\\\]", _replace_block, content)
    return re.sub(r"\\\((.+?)\\\)", _replace_inline, content)


def _normalize_same_line_block_math(content: str) -> str:
    def _replace(match: re.Match[str]) -> str:
        indentation, expression = match.groups()
        return f"{indentation}$$\n{indentation}{expression.strip()}\n{indentation}$$"

    return SAME_LINE_BLOCK_MATH_PATTERN.sub(_replace, content)


def _normalize_heading_marker_prefix(line: str) -> str:
    return re.sub(
        r"^([ \t]{0,3})([＃#]{1,6})(?=\s*\S)",
        lambda match: f"{match.group(1)}{'#' * len(match.group(2))}",
        line,
    )


def _is_likely_heading_fragment(fragment: str) -> bool:
    normalized = _normalize_heading_marker_prefix(fragment).strip()
    match = re.match(r"^(#{1,6})\s*(.+)$", normalized)
    if not match:
        return False

    title = match.group(2).strip()
    if not title or len(title) > 120 or re.search(r"https?://", title):
        return False

    return True


def _expand_inline_heading_line(line: str) -> list[str]:
    normalized_line = _normalize_heading_marker_prefix(line)
    match = re.match(r"^(.+\S)\s+(#{1,6}\s*.+)$", normalized_line)

    if not match:
        return [normalized_line]

    prefix, heading_fragment = match.group(1), match.group(2)
    if not _is_likely_heading_fragment(heading_fragment):
        return [normalized_line]

    return [prefix, "", heading_fragment.lstrip()]


def _normalize_markdown_line(line: str) -> str:
    line = re.sub(
        r"^([ \t]{0,3})\\([＃#]{1,6})(?=\s|\S)",
        lambda match: f"{match.group(1)}{'#' * len(match.group(2))}",
        line,
    )
    line = re.sub(r"^(#{1,6})(\S)", r"\1 \2", line)

    duplicate_heading = re.match(
        r"^([ \t]{0,3})(#{1,6})[ \t]+#{1,6}(?:[ \t]+(.*?))?[ \t]*$",
        line,
    )
    if duplicate_heading:
        leading, marker, title = duplicate_heading.groups()
        return f"{leading}{marker} {title.strip()}" if title and title.strip() else ""

    if re.match(r"^[ \t]{0,3}#{1,6}[ \t]*$", line):
        return ""

    line = re.sub(r"^([ \t]{0,3}[-*+])(\S)", r"\1 \2", line)
    return re.sub(r"^([ \t]{0,3}\d+[.)、])(\S)", r"\1 \2", line)


def _should_add_block_spacing(line: str, analysis_mode: bool) -> bool:
    if not line:
        return False
    if re.match(r"^#{1,6}\s", line):
        return True
    if analysis_mode and re.match(r"^[-*+]\s", line):
        return True
    return False


def normalize_llm_markdown(content: str | None, analysis_mode: bool = False) -> str:
    if not content:
        return ""

    masked, segments = _mask_code_segments(content.replace("\r\n", "\n").replace("\r", "\n"))
    normalized = _normalize_same_line_block_math(
        _normalize_escaped_inline_math(
            _normalize_bracket_math(
                re.sub(
                    r"\$\$([\s\S]+?)\\\$\$",
                    lambda match: f"$${match.group(1)}$$",
                    re.sub(
                        r"\\\$\$([\s\S]+?)\$\$",
                        lambda match: f"$${match.group(1)}$$",
                        re.sub(r"\\\$\$([\s\S]+?)\\\$\$", lambda match: f"$${match.group(1)}$$", masked),
                    ),
                )
            )
        )
    )

    lines = [
        _normalize_markdown_line(expanded_line)
        for line in normalized.split("\n")
        for expanded_line in _expand_inline_heading_line(line)
    ]
    normalized_lines: list[str] = []

    for index, line in enumerate(lines):
        trimmed = line.strip()
        previous_trimmed = normalized_lines[-1].strip() if normalized_lines else ""
        next_trimmed = lines[index + 1].strip() if index + 1 < len(lines) else ""
        needs_spacing = _should_add_block_spacing(trimmed, analysis_mode)

        if needs_spacing and previous_trimmed:
            normalized_lines.append("")

        normalized_lines.append(line)

        if needs_spacing and next_trimmed:
            normalized_lines.append("")

    normalized = "\n".join(normalized_lines)
    normalized = re.sub(r"\n{3,}", "\n\n", normalized).rstrip()
    return _unmask_code_segments(normalized, segments)
