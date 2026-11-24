"""Build the editable academic report from the project and recorded QA evidence.

Usage: python scripts/generate-report.py [--evidence path/to/evidence.json]
Dependencies: python-docx and Pillow. The Codex workspace Python includes both.
"""

import argparse
import json
import tempfile
from pathlib import Path

from docx import Document
from docx.enum.section import WD_SECTION_START
from docx.enum.style import WD_STYLE_TYPE
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Mm, Pt, RGBColor
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
TITLE = "Backup and Recovery System with Automated Restore Testing"
OUTPUT = ROOT / "deliverables" / "Backup_and_Recovery_System_Report.docx"
AUTHORS = [
    ("Student Name", "[Student Name]"),
    ("Topic Name", TITLE),
    ("Registration Number", "[Registration Number]"),
    ("Semester", "[Semester]"),
    ("Section", "[Section]"),
    ("Course Name", "[Course Name]"),
    ("Instructor Name", "[Instructor Name]"),
    ("University", "[University Name]"),
    ("Submission Deadline", "26 November 2026"),
]
HEADINGS = [
    "Title Page", "Acknowledge", "Submission Certificate", "Table of Contents",
    "Abstract", "Introduction", "Literature Review", "Working, Importance",
    "Strengths and Weaknesses", "Methodology/Framework", "Summary", "Conclusion",
    "Present and Future References", "Appendix",
]
REFERENCES = [
    ("M. Swanson, P. Bowen, A. Phillips, D. Gallup, and D. Lynes, “Contingency Planning Guide for Federal Information Systems,” NIST SP 800-34 Rev. 1, May 2010, updated Nov. 2010. doi: 10.6028/NIST.SP.800-34r1.",
     "https://doi.org/10.6028/NIST.SP.800-34r1"),
    ("CISA, FBI, NSA, and MS-ISAC, “#StopRansomware Guide,” updated Oct. 2023.",
     "https://www.cisa.gov/sites/default/files/2023-10/StopRansomware-Guide-508C-v3_1.pdf"),
    ("B. Zhu, K. Li, and H. Patterson, “Avoiding the Disk Bottleneck in the Data Domain Deduplication File System,” in Proc. 6th USENIX Conf. File and Storage Technologies (FAST ’08), Feb. 2008.",
     "https://www.usenix.org/conference/fast-08/avoiding-disk-bottleneck-data-domain-deduplication-file-system"),
    ("National Institute of Standards and Technology, “Secure Hash Standard (SHS),” FIPS 180-4, Aug. 2015. doi: 10.6028/NIST.FIPS.180-4.",
     "https://doi.org/10.6028/NIST.FIPS.180-4"),
    ("M. Dworkin, “Recommendation for Block Cipher Modes of Operation: Galois/Counter Mode (GCM) and GMAC,” NIST SP 800-38D, Nov. 2007. doi: 10.6028/NIST.SP.800-38D.",
     "https://doi.org/10.6028/NIST.SP.800-38D"),
    ("Vercel, “App Router,” Next.js Documentation. Accessed Nov. 24, 2026.",
     "https://nextjs.org/docs/app"),
    ("Supabase, “Creating a Supabase client for SSR,” Supabase Docs. Accessed Nov. 24, 2026.",
     "https://supabase.com/docs/guides/auth/server-side/nextjs"),
    ("Supabase, “Row Level Security,” Supabase Docs. Accessed Nov. 24, 2026.",
     "https://supabase.com/docs/guides/database/postgres/row-level-security"),
    ("Supabase, “Storage Buckets,” Supabase Docs. Accessed Nov. 24, 2026.",
     "https://supabase.com/docs/guides/storage/buckets/fundamentals"),
    ("Vercel, “Usage & Pricing for Cron Jobs,” Vercel Documentation. Accessed Nov. 24, 2026.",
     "https://vercel.com/docs/schedules/cron-jobs/usage-and-pricing"),
]


def element(tag, **attributes):
    node = OxmlElement(f"w:{tag}")
    for key, value in attributes.items():
        node.set(qn(f"w:{key}"), str(value))
    return node


def field(paragraph, instruction, placeholder):
    run = paragraph.add_run()
    run._r.append(element("fldChar", fldCharType="begin"))
    text = element("instrText")
    text.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
    text.text = f" {instruction} "
    run._r.append(text)
    run._r.append(element("fldChar", fldCharType="separate"))
    paragraph.add_run(placeholder)
    paragraph.add_run()._r.append(element("fldChar", fldCharType="end"))


def hyperlink(paragraph, label, url):
    relationship = paragraph.part.relate_to(
        url, "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink",
        is_external=True,
    )
    link = element("hyperlink")
    link.set(qn("r:id"), relationship)
    run = element("r")
    props = element("rPr")
    props.append(element("color", val="24354C"))
    props.append(element("u", val="single"))
    run.append(props)
    content = element("t")
    content.text = label
    run.append(content)
    link.append(run)
    paragraph._p.append(link)


class Report:
    def __init__(self, diagrams, evidence):
        self.doc = Document()
        self.diagrams = diagrams
        self.evidence = evidence
        self.figure_count = 0
        self.table_count = 0
        self.chapter_count = 0
        props = self.doc.core_properties
        props.title = TITLE
        props.subject = "Academic software engineering project report"
        props.author = "[Student Name]"
        props.last_modified_by = "[Student Name]"
        props.keywords = "backup, restoration, file integrity, RPO, RTO, restore testing"
        styles = self.doc.styles
        for name, size, bold in [
            ("Normal", 11.5, False), ("Title", 25, True), ("Heading 1", 17, True),
            ("Heading 2", 13.5, True), ("Heading 3", 12, True),
            ("Caption", 10, False), ("Header", 9, False), ("Footer", 9, False),
        ]:
            style = styles[name]
            style.font.name = "Times New Roman"
            style.font.size = Pt(size)
            style.font.bold = bold
            style.font.italic = False
            style.font.color.rgb = RGBColor(0, 0, 0)
            fonts = style.element.rPr.find(qn("w:rFonts"))
            for attribute in ("asciiTheme", "hAnsiTheme", "eastAsiaTheme", "cstheme"):
                if fonts is not None:
                    fonts.attrib.pop(qn(f"w:{attribute}"), None)
        title_properties = styles["Title"].element.pPr
        title_border = title_properties.find(qn("w:pBdr"))
        if title_border is not None:
            title_properties.remove(title_border)
        for name in ("toc 1", "toc 2"):
            toc_style = styles.add_style(name, WD_STYLE_TYPE.PARAGRAPH)
            toc_style.style_id = name.replace(" ", "").upper()
            toc_style.element.attrib.pop(qn("w:customStyle"), None)
            toc_style.base_style = styles["Normal"]
            toc_style.font.name = "Times New Roman"
            toc_style.font.size = Pt(10.5)
            toc_style.font.bold = name == "toc 1"
            toc_style.paragraph_format.space_after = Pt(0)
            toc_style.paragraph_format.space_before = Pt(0)
            toc_style.paragraph_format.line_spacing = 1.05
            if name == "toc 2":
                toc_style.paragraph_format.left_indent = Inches(.17)
        normal = styles["Normal"].paragraph_format
        normal.space_after = Pt(7.5)
        normal.line_spacing = 1.17
        normal.widow_control = True
        for name, before, after in [("Heading 1", 0, 13), ("Heading 2", 11, 5), ("Caption", 5, 10)]:
            fmt = styles[name].paragraph_format
            fmt.space_before = Pt(before)
            fmt.space_after = Pt(after)
        self._numbering()
        self._geometry(self.doc.sections[0])
        self._page_numbers(self.doc.sections[0], "lowerRoman", 1)
        self.doc.settings.element.append(element("updateFields", val="true"))

    def _numbering(self):
        numbering = self.doc.part.numbering_part.element
        abstract = element("abstractNum", abstractNumId=50)
        abstract.append(element("multiLevelType", val="singleLevel"))
        level = element("lvl", ilvl=0)
        for tag, value in [
            ("start", 1), ("numFmt", "decimal"), ("suff", "space"),
            ("lvlText", "%1."), ("lvlJc", "left"),
        ]:
            level.append(element(tag, val=value))
        abstract.append(level)
        first_num = numbering.find(qn("w:num"))
        first_num.addprevious(abstract)
        instance = element("num", numId=50)
        instance.append(element("abstractNumId", val=50))
        numbering.append(instance)

    @staticmethod
    def _geometry(section):
        section.page_width = Mm(210)
        section.page_height = Mm(297)
        section.top_margin = Mm(23)
        section.bottom_margin = Mm(22)
        section.left_margin = Mm(24)
        section.right_margin = Mm(24)
        section.header_distance = Mm(11)
        section.footer_distance = Mm(11)

    @staticmethod
    def _page_numbers(section, number_format, start):
        properties = section._sectPr
        old_numbering = properties.find(qn("w:pgNumType"))
        if old_numbering is not None:
            properties.remove(old_numbering)
        properties.insert_element_before(
            element("pgNumType", fmt=number_format, start=start),
            "w:cols", "w:formProt", "w:vAlign", "w:noEndnote", "w:titlePg",
            "w:textDirection", "w:bidi", "w:rtlGutter", "w:docGrid", "w:printerSettings", "w:sectPrChange",
        )

    def section(self, number_format, start=1):
        section = self.doc.add_section(WD_SECTION_START.NEW_PAGE)
        self._geometry(section)
        section.header.is_linked_to_previous = False
        section.footer.is_linked_to_previous = False
        header = section.header.paragraphs[0]
        header.text = "Backup and Recovery System"
        header.style = "Header"
        props = header._p.get_or_add_pPr()
        borders = element("pBdr")
        borders.append(element("bottom", val="single", sz=5, space=5, color="D9D9D9"))
        props.append(borders)
        footer = section.footer.paragraphs[0]
        footer.style = "Footer"
        footer.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        field(footer, "PAGE", "1")
        self._page_numbers(section, number_format, start)

    def heading(self, name, new_page=True):
        assert name == HEADINGS[self.chapter_count]
        self.chapter_count += 1
        p = self.doc.add_paragraph(name, "Heading 1")
        p.paragraph_format.page_break_before = new_page
        num = element("numPr")
        num.append(element("ilvl", val=0))
        num.append(element("numId", val=50))
        p._p.get_or_add_pPr().append(num)
        return p

    def sub(self, name, new_page=False, toc=True):
        p = self.doc.add_paragraph(name, "Heading 2" if toc else "Heading 3")
        p.paragraph_format.page_break_before = new_page

    def prose(self, *paragraphs):
        for paragraph in paragraphs:
            self.doc.add_paragraph(paragraph)

    def pairs(self, pairs):
        for label, value in pairs:
            p = self.doc.add_paragraph()
            p.paragraph_format.space_after = Pt(6)
            p.add_run(f"{label}   ").bold = True
            p.add_run(str(value))

    def code(self, value):
        for line in str(value).splitlines():
            p = self.doc.add_paragraph()
            p.paragraph_format.space_after = Pt(0.7)
            p.paragraph_format.line_spacing = 1.13
            p.paragraph_format.left_indent = Inches(.13)
            run = p.add_run(line)
            run.font.name = "Consolas"
            run.font.size = Pt(8.5)

    def table(self, name, titles, rows, widths):
        self.table_count += 1
        p = self.doc.add_paragraph(f"Table {self.table_count}. {name}", "Caption")
        p.paragraph_format.keep_with_next = True
        p.paragraph_format.space_after = Pt(5)
        t = self.doc.add_table(rows=1, cols=len(titles))
        t.alignment = WD_TABLE_ALIGNMENT.CENTER
        t.autofit = False
        for col, width in zip(t.columns, widths):
            col.width = Inches(width)
        borders = element("tblBorders")
        for side in ("top", "left", "bottom", "right", "insideH", "insideV"):
            borders.append(element(side, val="single", sz=5, color="D9D9D9"))
        t._tbl.tblPr.insert_element_before(borders, "w:shd", "w:tblLayout", "w:tblCellMar", "w:tblLook")
        margins = element("tblCellMar")
        for side, size in [("top", 85), ("left", 135), ("bottom", 85), ("right", 135)]:
            margins.append(element(side, w=size, type="dxa"))
        t._tbl.tblPr.insert_element_before(margins, "w:tblLook")
        for i, row in enumerate([titles, *rows]):
            actual_row = t.rows[0] if i == 0 else t.add_row()
            pr = actual_row._tr.get_or_add_trPr()
            pr.append(element("cantSplit"))
            if i == 0:
                pr.append(element("tblHeader"))
            for cell, value, width in zip(actual_row.cells, row, widths):
                cell.width = Inches(width)
                cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
                color = "E7EDF4" if i == 0 else ("F7F9FB" if i % 2 == 0 else "FFFFFF")
                cell._tc.get_or_add_tcPr().append(element("shd", fill=color))
                p = cell.paragraphs[0]
                p.paragraph_format.space_after = Pt(0)
                p.paragraph_format.line_spacing = 1.12
                run = p.add_run(str(value))
                run.font.size = Pt(10.5)
                run.bold = i == 0
        self.doc.add_paragraph().paragraph_format.space_after = Pt(0)

    def figure(self, path, name, max_width=6.35, max_height=5.3, new_page=False):
        self.figure_count += 1
        with Image.open(path) as image:
            aspect = image.width / image.height
        p = self.doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.page_break_before = new_page
        p.paragraph_format.keep_with_next = True
        p.paragraph_format.space_after = Pt(0)
        shape = p.add_run().add_picture(str(path), width=Inches(min(max_width, max_height * aspect)))
        shape._inline.docPr.set("descr", name)
        caption = self.doc.add_paragraph(f"Figure {self.figure_count}. {name}", "Caption")
        caption.alignment = WD_ALIGN_PARAGRAPH.CENTER
        caption.paragraph_format.keep_with_next = False

    def front_matter(self):
        title_label = self.heading("Title Page", False)
        title_label.paragraph_format.space_before = Pt(62)
        title_label.paragraph_format.space_after = Pt(33)
        title_label.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p = self.doc.add_paragraph(TITLE, "Title")
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_after = Pt(15)
        p = self.doc.add_paragraph("Academic Software Engineering Project Report")
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_after = Pt(57)
        self.pairs(AUTHORS)
        self.section("lowerRoman", start=2)
        self.heading("Acknowledge", False)
        self.prose(
            "I gratefully acknowledge the guidance of my instructor and the academic support provided during the course. The project applied concepts from software engineering, databases, and information security to the problem of recovering files after loss or corruption.",
            "I also acknowledge the maintainers of the open-source tools and the standards and documentation cited in this report. Their materials informed the design and provided the basis for defining and evaluating recovery evidence.",
        )
        self.heading("Submission Certificate")
        self.prose(
            f"This page records the submission of the project titled “{TITLE}” for academic assessment. The signature fields below are reserved for the student and the instructor.",
        )
        self.pairs(AUTHORS[:1] + AUTHORS[2:-1] + [("Submission Date", "[Submission Date]")])
        self.doc.add_paragraph()
        self.pairs([("Student Signature", "_________________________________"), ("Instructor Signature", "______________________________")])
        self.heading("Table of Contents")
        field(self.doc.add_paragraph(), r'TOC \o "1-2" \h \z \u', "In Microsoft Word, select Update Table to calculate page numbers.")
        self.section("decimal")
        self.heading("Abstract", False)
        self.prose(
            "Backup software often reports that a copy has been written, while the ability to recover that copy remains untested. An incomplete archive, an unavailable object, or a lost encryption key may only become visible when a user needs the data. This project develops a web application that records backup creation, archive verification, and actual restore tests as distinct outcomes.",
            "The application uses the Next.js App Router and a Node.js processing runtime. Supabase provides authentication, PostgreSQL metadata, and private object storage. Users group selected files into a source, upload directly to storage, and create a full ZIP backup with a versioned file manifest. SHA-256 digests describe individual files and the stored artifact. Optional AES-256-GCM adds authenticated encryption using server-side keys.",
            "The recovery engine validates and extracts files into an isolated temporary directory. An automated test invokes the same recovery mechanism, reads the extracted files back, and compares their paths, sizes, and content hashes with the manifest. A standard recovery additionally publishes verified output to a separate private destination. Job states, verification records, restore timings, and audit events provide evidence for users and reviewers.",
            "The prototype is scoped to small file collections and bounded serverless jobs. Its contribution is a reproducible method for demonstrating recovery of a selected point and for distinguishing observable test results from recovery objectives. It is designed for an academic demonstration with separately configured managed services.",
        )

    def background(self):
        self.heading("Introduction")
        self.sub("Problem and project objectives", toc=False)
        self.prose(
            "A recovery point is a copy of data captured at a known time. An organization can retain many copies and still discover that none can reconstruct the data it needs. This gap matters when a backup job is evaluated solely on whether its final write completed. Archive readability, recoverable keys, file completeness, and a usable destination must also be considered.",
            "Hardware faults can make a local drive unreadable. Software defects may overwrite or silently damage files. Human error can delete a folder or replace an older version that is still needed. Cybersecurity incidents can impair production data and also affect backups controlled by the same identity. A recovery plan therefore combines reliable copies, suitable retention, and periodically exercised recovery procedures [1], [2].",
            "The objective is to build a deployable file backup application that creates a verified record for each recovery point, reconstructs its files without overwriting the source, and measures the same process automatically. A successful test should identify the recovery point and verified file counts. A failed test should retain its reason and avoid publishing partial output as recovered data.",
        )
        self.sub("Scope and proposed solution", toc=False)
        self.prose(
            "The project handles user-selected files and relative folder paths from the browser. The browser cannot enumerate arbitrary local folders without a user selection. This scope suits a small group of documents or configuration files. Database point-in-time recovery, operating system images, active workloads, and restoration of application dependencies sit outside the demonstration.",
            "Users access an authenticated workspace to manage sources and schedules, inspect backup jobs, verify recovery points, restore files, review tests, and export evidence. The application preserves source data in one bucket and uses different buckets and paths for archives and recovered outputs. An account can set RPO and RTO targets and compare those targets with recorded evidence.",
        )
        self.heading("Literature Review")
        self.sub("Backup methods and recovery planning", toc=False)
        self.prose(
            "A full backup contains the entire chosen dataset at one time. It requires reading and storing all selected data for each recovery point, but each point can be processed independently. An incremental backup contains changes since the last applicable backup. Restoring an incremental chain requires its base and the necessary ordered changes. A differential backup contains changes since the most recent full backup, so restoration requires the base and the chosen differential copy. Shorter recoveries, smaller writes, and a simpler dependency graph can compete with each other.",
            "This project uses full file snapshots. The default aggregate limit makes it reasonable to recreate each archive, and an isolated test of one point requires only that archive, its metadata, and its key if encrypted. Larger installations benefit from scheduling around load, managing dependency retention, and selecting storage for the expected throughput. Research on disk-based deduplication illustrates that locating repeated blocks can create its own indexing and disk-I/O bottlenecks [3].",
            "RPO specifies how much elapsed time worth of data loss is acceptable. A target of 24 hours implies that an outage occurring now should ordinarily have a usable recovery point captured within the previous 24 hours. RTO specifies the maximum tolerable recovery duration after disruption. Recovery planning derives these objectives from impact analysis and includes testing, training, and maintenance [1]. The time of the latest successful copy and the measured time of a selected restore answer different operational questions.",
        )
        self.sub("Integrity, encryption and evidence", toc=False)
        self.prose(
            "A SHA-256 digest provides a fixed-size fingerprint that can be recomputed to detect changed bytes [4]. Per-file fingerprints make mismatches localizable, and the complete archive digest gives an early check before extraction. A digest depends on the trustworthiness of its reference value. Protecting a manifest alongside its archive and protecting a reference digest in an authorized database record reduces accidental inconsistency.",
            "AES-GCM is an authenticated encryption mode. With the correct key, nonce, and authentication tag, the server can decrypt an encrypted artifact and check its authenticity [5]. A cryptographic check cannot demonstrate that a usable directory was rebuilt. An automated restore test adds a filesystem write and reread followed by content comparison. CISA’s recovery guidance also addresses an independent concern by recommending offline encrypted copies and periodic testing [2].",
        )
        self.sub("Background History and Evolution", new_page=True)
        self.prose(
            "Early manual backups depended on an operator choosing files, copying them to removable media, labeling the media, and recording where each copy was stored. Magnetic tape made large sequential backup sets practical and allowed media to be removed and stored elsewhere. Retrieval time depended on finding and reading the correct media. Operations teams often scheduled backups around the time required to scan files and write sequentially.",
            "Disk storage brought faster random access and made it possible to retrieve smaller portions without winding through a tape. It also enabled approaches such as deduplication, where a system stores a repeated portion once and refers to it from later backups. Zhu, Li, and Patterson reported on a disk-based system that used compact summaries and locality-aware access to reduce disk index lookups [3].",
            "Network-based backups centralized the storage and schedules used by multiple machines. Cloud object storage further separated storage capacity from the computer that initiated a backup. It allowed operators to create object namespaces and authorize specific transfers, although a cloud project still has access, capacity, and service boundaries. Automated backup platforms made policy-based scheduling and retention practical for smaller teams that could not operate a dedicated media workflow.",
            "Modern verification progressively added checks beyond media availability. Block checksums and signed or authenticated content detect inconsistent bytes. Backup catalogs and manifests describe the intended file set. Recovery exercises validate the data and procedure together. An automated isolated restore captures part of that exercise after a backup is created, exposing errors before a user depends on the recovery point. A full disaster recovery exercise still includes people, alternative services, credentials, and business operations [1], [2].",
        )
        self.table("Backup storage and typical verification evidence", ("Storage", "Recovery consideration", "Evidence"), [
            ("Removable media", "Recover the correct generation and locate compatible equipment.", "Media catalog and test read."),
            ("Disk and network", "Manage access, throughput, and version dependencies.", "Content digests and timed restoration."),
            ("Cloud object storage", "Plan for identity, provider outages, and download limits.", "Object checks plus isolated or independent restore."),
        ], (1.35, 2.85, 2.15))

    def implementation(self):
        self.heading("Working, Importance")
        self.sub("Application and data boundaries")
        self.prose(
            "The browser presents a Next.js App Router workspace with an overview and dedicated views for sources, jobs, history, recovery points, restore operations, restore tests, retention, reports, audit events, and settings [6]. React components handle interactive forms, file selection, and chart rendering. Dashboard figures derive from the account’s stored records. A new account begins without activity or success statistics.",
            "Supabase Auth holds identity records and supports cookie-based sessions in Next.js [7]. Route handlers verify the session before processing a user operation. Public client credentials allow authentication and scoped transfers. A separate server-only client performs trusted mutations and storage work, with explicit ownership queries. PostgreSQL row-level security limits records available to authenticated users through the data interface [8].",
            "Storage separates source objects, archives, and recovered files into the private source-files, backup-archives, and restored-files buckets. The upload plan authorizes specific object paths. The browser uses that authorization to upload directly to storage, which keeps source bytes outside the Next.js request body. The server reads each completed upload to record its actual size and SHA-256 digest. Downloads of recovered content use a short-lived signed URL issued after an ownership check [9].",
        )
        self.sub("Compression, encryption and verification")
        self.prose(
            "The processing function reads the source’s completed files and checks each object’s size against operation limits. It computes SHA-256 hashes and constructs a manifest from relative paths, byte sizes, and digests. The ZIP writer uses DEFLATE compression. An encrypted point wraps the ZIP using AES-256-GCM with a versioned envelope, 12-byte nonce, and 16-byte authentication tag. The final digest describes the stored ZIP or encrypted envelope [4], [5].",
            "The backup job and its recovery point have distinct records. The server re-downloads a newly stored archive and verifies the stored bytes before finalizing the job, point, and audit event in a database transaction. It checks the artifact digest, authenticates and decrypts the artifact where required, and confirms the count, paths, sizes, and digests of its entries. It also compares the embedded manifest with the PostgreSQL copy. The user can repeat these checks before selecting a point for recovery.",
        )
        self.sub("Recovery and automated testing", new_page=True)
        self.prose(
            "The shared restore engine uses a new temporary directory for the operation. It refuses unsafe relative paths and conflicting entries, and it bounds extraction by configured file count and byte limits. It writes validated entries, reads them back from disk, and compares their contents with the expected manifest. It removes its own workspace on completion or failure. A normal restore writes verified files into a new private prefix and records the destination. A test leaves the permanent restore destination untouched.",
            "A test records its selected recovery point, elapsed operation time, restored bytes, verified files, and any failure details. The separate restoration and verification timings clarify how long it took to write and check the result. A post-backup test follows the same path as a manually initiated test, including for a scheduled backup whose source has automatic testing enabled. A failed test remains visible alongside the backup record so the user can investigate the affected point.",
        )
        self.sub("Scheduling, targets and retention")
        self.prose(
            "Schedules store intended local time, timezone, recurrence, and the next eligible execution. The protected Vercel scheduler is configured for 00:00 UTC daily and processes a bounded amount of work per invocation. The local schedule time is therefore a due time. Actual execution follows an available poll with enough time to process the job. Vercel documents once-daily scheduling and limited timing precision for Hobby [10].",
            "The recovery point age can be compared with the configured RPO. The measured duration from a completed restore or restore test can be compared with the RTO in its stated context. An isolated test has a narrower scope than full incident recovery and its timing may omit delays such as administrator response or external dependency recovery.",
            "Retention policies combine recent recovery points and daily, weekly, or monthly buckets. A preview identifies candidates before cleanup. The policy preserves a configured minimum of verified points and the newest verified point with a passed restore test. The worker skips points with active restores or tests. Source deletion removes source files while preserving existing recovery points. Audit history connects meaningful events to resources and timestamps.",
        )
        self.heading("Strengths and Weaknesses")
        self.sub("Strengths", toc=False)
        self.prose(
            "The backup archive is self-describing. If format metadata remains available and the key is recoverable when required, its manifest tells the engine which files and directories to reconstruct. The shared restore implementation makes a passing test directly relevant to the extraction and local validation steps of a normal restore. Digests and detailed job outcomes give an operator a basis for investigation when recovery fails.",
            "The browser-to-storage transfer avoids a function request body limit on user uploads. Supabase provides a managed identity boundary and durable metadata. Private destinations keep recovered content separate from the source. The compact architecture is deployable as a single Next.js application with managed persistence.",
        )
        self.sub("Weaknesses and improvement opportunities", toc=False)
        self.prose(
            "The default demonstration limits are 10 MiB per file, 20 MiB per source operation, 30 MiB per archive, and 100 files. ZIP creation, optional encryption, download, extraction, and repeated hashing consume time and memory. The operation may fail under provider limits or slow network transfers. A larger deployment would benefit from streaming, queue-based execution, and workload-specific measurements.",
            "Temporary storage and a serverless invocation are finite. In a forced termination, application-level catch and cleanup logic may not run. Durable state and subsequent reconciliation can identify expired work, and object lifecycle management can address any orphaned artifacts. A daily poll also delays eligibility compared with a scheduler that can run more frequently [10].",
            "Source data and backups share the same Supabase project. A project outage, administrator compromise, or destructive action at that boundary can affect both. A separated provider or independently controlled off-site copy would reduce that coupling. Object lock or another independently enforced retention mechanism could improve resilience against credential compromise [2].",
            "Encrypted recovery depends on keeping the correct key. Losing it can leave bytes intact but unreadable. A coordinated rotation must preserve the old key for older versions or re-encrypt and verify archives before retiring that key. A production rotation design should add a versioned key store and a documented recovery procedure without recording secrets in file metadata or audit events.",
        )

    def methodology(self):
        self.heading("Methodology/Framework")
        self.sub("Requirement analysis and technology selection")
        self.prose(
            "The requirements were organized around an inspectable recovery workflow. Identity and storage establish the trust boundary. An archive with verifiable content establishes a usable recovery point. Actual isolated restoration provides evidence beyond successful upload. The remaining modules support scheduling, recovery targets, retention, and an auditable user experience.",
        )
        self.table("Selected functional and quality requirements", ("ID", "Requirement", "Implementation evidence"), [
            ("R1", "Group and upload individual files or folder contents.", "Source records, upload plan, private source object, completed metadata."),
            ("R2", "Create a recoverable archive within declared limits.", "ZIP, versioned manifest, complete artifact digest, backup job."),
            ("R3", "Validate and restore to a separate private destination.", "Shared engine, disk reread, restore record, scoped download."),
            ("R4", "Run a genuine automated restore test.", "Temporary restore directory and a result with verified counts and timing."),
            ("R5", "Isolate accounts and secrets.", "Server session checks, ownership filters, RLS and private buckets."),
            ("R6", "Support recurring execution and controlled retention.", "Due-time records, authorized cron, preview, and audit events."),
        ], (.65, 2.4, 3.3))
        self.prose(
            "The technology selection prioritizes a single deployable application. Next.js routes expose the user and scheduler entry points. Supabase replaces self-managed identity, PostgreSQL, and storage. Native Node.js cryptography supplies hashing and authenticated encryption, while ZIP libraries handle the standard archive format. The archive and restore logic can run independently of a deployed account during core tests.",
        )
        self.sub("Overall architecture and data flow", new_page=True)
        self.figure(self.diagrams["architecture"], "Overall architecture and the managed service boundary.")
        self.prose(
            "The application exchanges authenticated metadata with Supabase and sends direct upload authorization to the browser. A browser transfers source bytes to storage. Processor requests retrieve objects separately and use temporary space only while running.",
        )
        self.figure(self.diagrams["flow"], "Data flow from file selection to recorded recovery evidence.")
        self.prose(
            "The storage and PostgreSQL operations are separate network calls. Processing states distinguish in-progress work from terminal results. An expiring lease serializes workspace mutations for the user, and a request identifier connects retries to prior processing records.",
        )
        self.sub("Backup and restoration processes", new_page=True)
        self.figure(self.diagrams["backup"], "Backup process with validation before publication.")
        self.prose(
            "A full backup is bound to one source and one job. A known request identifier and database constraints support duplicate detection. The job record allows later inspection of the attempt even when no recovery point is produced.",
        )
        self.figure(self.diagrams["restore"], "Restore process with a new private output destination.")
        self.prose(
            "Extraction uses the documented relative file tree. Output is read and verified before an ordinary restore is reported successful. A new operation prefix keeps recovery attempts separate and protects the original source.",
        )
        self.sub("Automated restore-testing process", new_page=True)
        self.figure(self.diagrams["test"], "Automated restore-testing process and durable result.")
        self.prose(
            "The test checks the same archive and invokes the same temporary restoration used for an ordinary recovery. It reports file counts, restored bytes, timing, and errors. Cleanup is confined to the current temporary directory. Testing after creation can expose an unusable point before an emergency, while a later re-test can detect changes to storage, metadata, or available keys.",
        )
        self.sub("Database design and security")
        self.figure(self.diagrams["er"], "Logical entity relationship diagram for project records.", max_height=4.7)
        self.prose(
            "An authenticated user owns the workspace records. A source groups uploaded files and schedules. Jobs record attempts, recovery points index completed artifacts, and restore and test records refer to selected points. Composite foreign keys enforce ownership consistency across related tables. Retention and audit records preserve policy and operation history. The migration is authoritative for exact columns and constraints.",
        )
        self.sub("Integration, testing and deployment", new_page=True)
        self.prose(
            "The test method separates local archive and filesystem behavior from environment-dependent checks. Local tests can exercise valid and changed bytes, encryption, temporary output, and file verification without any hosted credentials. End-to-end checks exercise browser routes and forms. A hosted acceptance run additionally uses real Storage, Auth, and PostgreSQL. Account isolation requires two distinct authenticated identities or an equivalent RLS harness.",
        )
        cases = self.evidence.get("cases")
        if cases:
            self.table("Executed verification cases", ("Case", "Method and observed result", "Status"), cases, (1.45, 3.83, 1.07))
        else:
            self.table("Acceptance checks and expected outcomes", ("Case", "Expected evidence", "Status"), [
                ("Normal backup", "An archive, manifest, and stored artifact checksum are produced.", "Pending"),
                ("Restore", "Restored paths and file hashes match the accepted manifest.", "Pending"),
                ("Changed archive", "An integrity error is recorded and no verified output is published.", "Pending"),
                ("Cross-account access", "The second test account cannot read or recover the first account’s data.", "Pending"),
                ("Scheduled job", "An authenticated scheduler call acquires and processes eligible work.", "Pending"),
            ], (1.45, 3.83, 1.07))
        self.prose(*self.evidence.get("validation_notes", []))
        self.sub("Threat model", new_page=True)
        self.prose(
            "The trust boundary separates the signed-in browser from privileged storage, database, and encryption operations. Browser calls carry an authenticated session and, for direct transfer, a token scoped to a single object. The service credentials and archive key remain in server configuration.",
        )
        self.table("Threats and application controls", ("Threat", "Control and residual exposure"), [
            ("Accidental deletion", "Separate restore destination and retention checks. Shared provider remains a common dependency."),
            ("Archive or manifest corruption", "Stored artifact digest, manifest comparison, per-file validation, and restore testing."),
            ("Cross-account access", "Session and ownership checks, row-level policies, private objects, and scoped signed URLs."),
            ("Unsafe archive entries", "Confined relative paths, overlapping-entry rejection, and bounded extraction."),
            ("Key loss or inaccessible data", "Server-only key handling. Independent key recovery and rotation require an operational plan."),
            ("Incomplete jobs or storage exhaustion", "Finite input and archive limits, durable operation states, and explicit failures."),
        ], (1.82, 4.53))
        self.prose(
            "A passed file-level restore provides evidence for the selected archive and invocation. Failure of an entire cloud project and recovery of the encryption key require separate exercises. The independently controlled copies discussed in Section 13 address this wider recovery boundary.",
        )

    def conclusions(self):
        self.heading("Summary")
        self.prose(
            "The project integrates browser-selected file sources, bounded backup processing, recoverable ZIP artifacts, archive verification, isolated restoration, restore-test reporting, scheduling, retention, and audit records in one application. Its central unit is a recovery point with a known source, file manifest, artifact digest, and separately recorded recovery evidence.",
        )
        self.prose(*self.evidence.get("summary", [
            "The test plan evaluates archive creation, reconstruction, corruption detection, and the configured managed-service workflow. Evidence in the appendix documents the executed cases available for this edition.",
        ]))
        self.heading("Conclusion", False)
        self.doc.paragraphs[-1].paragraph_format.space_before = Pt(20)
        self.prose(
            "The design makes successful file recovery measurable by validating a selected archive, recreating its relative file tree, and comparing the resulting bytes with an expected manifest. It gives a student or small team a practical way to demonstrate file-level recovery and diagnose the difference between a successful backup job and recoverable data.",
            "The implementation addresses file backup and verification within a constrained managed deployment. Full disaster recovery additionally requires independent copies, separate access controls, exercise of recovery procedures, and measurements from the intended operating environment. Those controls determine whether recovery remains possible during the failures that affect the demonstration’s shared infrastructure.",
        )
        self.heading("Present and Future References")
        self.sub("Present References")
        for number, (citation, url) in enumerate(REFERENCES, start=1):
            p = self.doc.add_paragraph()
            p.paragraph_format.left_indent = Inches(.31)
            p.paragraph_format.first_line_indent = Inches(-.31)
            p.paragraph_format.space_after = Pt(7)
            p.add_run(f"[{number}]  {citation} [Online]. Available: ")
            hyperlink(p, url, url)
        self.sub("Future Directions", new_page=True)
        self.prose(
            "AI-assisted anomaly detection could flag unusual changes in file counts, backup size, timing, or digest distributions. Predictive backup failure detection could model repeated retries and falling storage headroom. Any system of this kind should be evaluated against recorded outcomes, should distinguish alerts from confirmed failures, and should leave deletion or recovery authorization with explicit rules.",
            "A distributed backup infrastructure could replicate verified recovery points across accounts or providers. Independently controlled immutable storage and offline copies would improve resilience when primary credentials are compromised, while periodic retrieval would establish that those copies remain usable. Continuous restore verification could test a sample of new points, retest older points, and escalate a failure before a point expires.",
            "Automated disaster recovery would extend this file-level design with dependency inventories, infrastructure templates, identity recovery, and measured failover exercises. Intelligent recovery prioritization could order workloads by dependencies and impact, while preserving a human approval point for cutover. RPO and RTO would then be measured from incident detection through restoration of service, rather than from archive processing alone.",
        )

    def appendix(self):
        self.heading("Appendix")
        self.sub("Application screenshots")
        screenshots = self.evidence.get("screenshots")
        if screenshots is None:
            folder = ROOT / "docs" / "screenshots"
            captures = [
                ("overview.png", "Workspace overview after the fictional backup and restore-test runs."),
                ("sources.png", "Source management with the integration and demonstration datasets."),
                ("restore-testing.png", "Restore testing with available recovery points and recent test outcomes."),
                ("restore-test-history.png", "Restore-test history with separate passing and failed outcomes."),
            ]
            screenshots = [
                {"path": str(folder / name), "caption": caption}
                for name, caption in captures if (folder / name).is_file()
            ]
        if screenshots:
            for index, screenshot in enumerate(screenshots):
                self.figure(
                    ROOT / screenshot["path"], screenshot["caption"],
                    max_height=4.2, new_page=index > 0 and index % 2 == 0,
                )
        else:
            self.prose("Application screenshots were unavailable for this edition.")
        self.sub("Manifest, backup and test evidence", new_page=True)
        self.prose(self.evidence.get("fixture_scope", "This section records generated examples when archived run evidence is available."))
        available = False
        for key, caption in [
            ("manifest", "Generated backup manifest"),
            ("backup", "Backup record or observed artifact metadata"),
            ("restore_report", "Observed restore test report"),
            ("verification", "Observed verification output"),
        ]:
            sample = self.evidence.get(key)
            if sample:
                self.sub(caption, toc=False)
                self.code(json.dumps(sample, ensure_ascii=False, indent=2) if not isinstance(sample, str) else sample)
                available = True
        if not available:
            self.prose("No sample records were supplied from an executed environment for this edition.")
        self.sub("Database schema and API summary", new_page=True)
        self.table("Database entities and selected fields", ("Table", "Ownership or parent reference", "Selected data"), [
            ("profiles", "id → Auth user", "Display name, RPO, RTO"),
            ("backup_sources", "user_id → Auth user", "Name, status, auto-test, encryption"),
            ("source_files", "source_id + user_id → source", "Relative path, size, digest"),
            ("backup_schedules", "source_id + user_id → source", "Frequency, timezone, due time"),
            ("backup_jobs", "source_id + user_id → source", "Status, elapsed time, errors"),
            ("backups", "backup_job_id + user_id → job", "Archive path, checksum, manifest"),
            ("restore_operations", "backup_id + user_id → backup", "Destination, counts, output files"),
            ("restore_tests", "backup_id + user_id → backup", "Trigger, status, verification details"),
            ("retention_policies", "source_id + user_id → source", "Calendar rules and minimum count"),
            ("audit_logs", "user_id → Auth user", "Operation, resource, status, time"),
            ("workspace_leases", "user_id → Auth user", "Lease token and expiry"),
        ], (1.55, 2.32, 2.48))
        self.table("Application API routes", ("Route", "Purpose"), self.evidence.get("routes", [
            ("GET /api/workspace", "Retrieve the authenticated workspace records."),
            ("POST /api/workspace", "Manage sources, plan or complete uploads, run backup and recovery, manage policies and settings."),
            ("GET /api/download", "Authorize download of a recovered file."),
            ("GET /api/report", "Export a selected backup or restore-test record."),
            ("GET /api/cron", "Evaluate due scheduling work using a server-only bearer secret."),
        ]), (2.25, 4.1))
        self.sub("Installation and configuration", new_page=True)
        self.prose(
            "Install the Node.js version documented in the repository. Run the dependency installation and copy the environment template to the local configuration file. Create a Supabase project and apply the migration files in order. This provisions the schema, row policies, and private buckets. Configure the Auth site URL and allowed redirect URLs for the local and hosted application.",
        )
        self.code("npm install\nCopy-Item .env.example .env.local\nnpx supabase login\nnpx supabase link --project-ref YOUR_PROJECT_REF\nnpx supabase db push\nnpm run dev")
        self.prose(
            "Set the Supabase URL and publishable key for the browser. Store the Supabase secret key, backup encryption key, and cron bearer secret as server-only configuration. The encryption key has 32 random bytes expressed as 64 hexadecimal characters. Generate a separate random value for the cron secret. Keep keys and actual settings out of version control. The environment template documents source and archive limits.",
            "For production, import the Git repository into Vercel, configure the application URL and the same environment keys, deploy, and update the Supabase authentication redirect allowlist. Public registration with email confirmation depends on a configured SMTP provider. Confirm the protected scheduled route, then exercise upload, backup, verification, restore, download, and a restore test using fictional data.",
        )
        publication = self.evidence.get("publication", {})
        if publication:
            paragraph = self.doc.add_paragraph()
            for i, (label, url) in enumerate(publication.items()):
                if i:
                    paragraph.add_run("    •    ")
                hyperlink(paragraph, label, url)
        self.sub("Test cases and technical glossary")
        self.prose(
            "A positive test creates a source with a nested file, backs it up, and compares restored bytes. A controlled negative test changes a disposable copy and expects a failure. A service-level test should also confirm that a different account cannot inspect the point or download the restore. Section 10 records the available executed checks.",
        )
        self.table("Technical glossary", ("Term", "Meaning"), [
            ("Manifest", "Versioned inventory of relative file paths, sizes, and expected digests."),
            ("Recovery point", "Snapshot associated with a completed backup and artifact."),
            ("RPO / RTO", "Maximum tolerable loss of recent data / maximum tolerable recovery duration."),
            ("RLS", "PostgreSQL row-level security applied to requests under restricted roles."),
            ("Signed URL", "Short-lived capability for a particular storage transfer."),
        ], (1.35, 5.0))

    def save(self, output):
        self.front_matter()
        self.background()
        self.implementation()
        self.methodology()
        self.conclusions()
        self.appendix()
        assert self.chapter_count == len(HEADINGS)
        output.parent.mkdir(parents=True, exist_ok=True)
        self.doc.save(output)


class Diagram:
    def __init__(self, width=1480, height=430):
        self.image = Image.new("RGB", (width, height), "white")
        self.draw = ImageDraw.Draw(self.image)
        self.nodes = {}
        for user_fonts in [Path("C:/Windows/Fonts"), Path("/usr/share/fonts/truetype/dejavu")]:
            if (user_fonts / "arial.ttf").exists():
                self.regular = str(user_fonts / "arial.ttf")
                self.bold = str(user_fonts / "arialbd.ttf")
                break
            if (user_fonts / "DejaVuSans.ttf").exists():
                self.regular = str(user_fonts / "DejaVuSans.ttf")
                self.bold = str(user_fonts / "DejaVuSans-Bold.ttf")
                break
        else:
            self.regular = "DejaVuSans.ttf"
            self.bold = "DejaVuSans-Bold.ttf"

    def add(self, key, x, y, title, description="", width=430, height=120):
        self.nodes[key] = ((x, y, x + width, y + height), title, description)

    def label(self, pos, value, size=29, bold=False, anchor="mm"):
        font = ImageFont.truetype(self.bold if bold else self.regular, size)
        self.draw.text(pos, value, anchor=anchor, fill="#23364f", font=font)

    def node_text(self, pos, value, width, size, bold=False):
        font_path = self.bold if bold else self.regular
        while ImageFont.truetype(font_path, size).getlength(value) > width:
            size -= 1
        self.label(pos, value, size, bold)

    def link(self, start, end, label=None, start_side="r", end_side="l", corners=()):
        def point(node, side):
            x, y, x2, y2 = self.nodes[node][0]
            return {
                "r": (x2, (y + y2) // 2), "l": (x, (y + y2) // 2),
                "t": ((x + x2) // 2, y), "b": ((x + x2) // 2, y2),
            }[side]

        a, b = point(start, start_side), point(end, end_side)
        color = "#637995"
        self.draw.line([a, *corners, b], fill=color, width=4, joint="curve")
        reach = 16
        x, y = b
        arrow = {
            "l": [(x - reach, y - 8), (x - reach, y + 8)],
            "r": [(x + reach, y - 8), (x + reach, y + 8)],
            "t": [(x - 8, y - reach), (x + 8, y - reach)],
            "b": [(x - 8, y + reach), (x + 8, y + reach)],
        }[end_side]
        self.draw.polygon([b, *arrow], fill=color)
        if label:
            mid_x, mid_y = (a[0] + b[0]) // 2, (a[1] + b[1]) // 2
            if a[0] == b[0]:
                self.label((mid_x + 14, mid_y), label, 25, anchor="lm")
            else:
                self.label((mid_x, mid_y - 22), label, 25)

    def save(self, path):
        for (x, y, x2, y2), title, description in self.nodes.values():
            self.draw.rounded_rectangle((x, y, x2, y2), radius=13, fill="#F1F5FA", outline="#A9B9CD", width=3)
            self.node_text(((x + x2) // 2, (y + y2) // 2 - (16 if description else 0)), title, x2 - x - 24, 31, bold=True)
            if description:
                self.node_text(((x + x2) // 2, (y + y2) // 2 + 22), description, x2 - x - 24, 26)
        self.image.save(path)
        return path


def flow(path, steps):
    diagram = Diagram(height=340)
    for i, (title, description) in enumerate(steps):
        y = 24 if i < 3 else 195
        j = i if i < 3 else 5 - i
        diagram.add(i, 21 + j * 506, y, title, description, width=425, height=118)
    for i in range(5):
        if i == 2:
            diagram.link(i, i + 1, start_side="b", end_side="t")
        else:
            diagram.link(i, i + 1, start_side="l" if i > 2 else "r", end_side="r" if i > 2 else "l")
    return diagram.save(path)


def make_diagrams(directory):
    paths = {}
    architecture = Diagram(height=435)
    architecture.add("browser", 22, 26, "Browser", "Workspace and selected files", width=385)
    architecture.add("identity", 545, 26, "Supabase Auth", "Sessions and identities", width=430)
    architecture.add("database", 1095, 26, "Supabase PostgreSQL", "Metadata, RLS and audit records", width=360)
    architecture.add("storage", 22, 280, "Private Supabase Storage", "Sources • archives • restored files", width=385)
    architecture.add("next", 545, 280, "Next.js on Vercel", "Sessions and route handlers", width=430)
    architecture.add("timer", 1095, 280, "Vercel Cron", "Daily authorized request", width=360)
    architecture.link("browser", "next", corners=((477, 86), (477, 340)))
    architecture.link("next", "identity", start_side="t", end_side="b")
    architecture.link("next", "storage", start_side="l", end_side="r")
    architecture.link("browser", "storage", start_side="b", end_side="t")
    architecture.link("timer", "next", start_side="l", end_side="r")
    architecture.link("next", "database", corners=((1024, 340), (1024, 86)))
    paths["architecture"] = architecture.save(directory / "architecture.png")
    for name, steps in {
        "flow": [
            ("Select files", "Browser folder or file picker"),
            ("Authorize transfer", "Session and scoped upload URLs"),
            ("Upload objects", "Browser → private source bucket"),
            ("Complete file records", "Confirm content and metadata"),
            ("Process recovery point", "Read objects and store the archive"),
            ("Record outcomes", "Persist evidence and display results"),
        ],
        "backup": [
            ("Load owned source", "Check job identity and limits"),
            ("Read source bytes", "Compute each SHA-256 digest"),
            ("Build ZIP and manifest", "Optionally encrypt the archive"),
            ("Store private artifact", "Compute the complete digest"),
            ("Verify stored archive", "Read and validate the artifact"),
            ("Finalize backup", "Record point, job and audit event"),
        ],
        "restore": [
            ("Select a backup", "Verify the session and ownership"),
            ("Read archive", "Check digest and decrypt if required"),
            ("Validate manifest", "Check paths, counts and sizes"),
            ("Restore in temporary space", "Write files and reread contents"),
            ("Publish verified files", "Use a new private output prefix"),
            ("Record and clean up", "Save status and enable downloads"),
        ],
        "test": [
            ("Select a recovery point", "Manual or post-backup trigger"),
            ("Precheck the archive", "Digest, decryption and manifest"),
            ("Create isolated workspace", "Dedicated temporary directory"),
            ("Run real restoration", "Extract files using the shared engine"),
            ("Reopen and compare", "Paths, sizes, digests and timings"),
            ("Persist the test result", "Clean up operation-owned files"),
        ],
    }.items():
        paths[name] = flow(directory / f"{name}.png", steps)

    er = Diagram(height=650)
    for key, x, y, title, description, width in [
        ("user", 20, 16, "Auth user", "id", 330),
        ("profile", 20, 183, "Profile", "id → user", 330),
        ("audit", 20, 354, "Audit event", "user_id • resource_id", 330),
        ("policy", 20, 518, "Retention policy", "user_id • source_id", 330),
        ("source", 464, 16, "Backup source", "id • user_id", 430),
        ("file", 1058, 16, "Source file", "source_id • user_id", 398),
        ("schedule", 1058, 174, "Schedule", "source_id • user_id", 398),
        ("job", 464, 183, "Backup job", "source_id • user_id", 430),
        ("backup", 464, 354, "Backup", "job_id • source_id • user_id", 430),
        ("restoration", 1058, 354, "Restore operation", "backup_id • user_id", 398),
        ("test", 1058, 518, "Restore test", "backup_id • user_id", 398),
    ]:
        er.add(key, x, y, title, description, width=width, height=109)
    er.link("user", "profile", "1 to 0–1", start_side="b", end_side="t")
    er.link("user", "source", "1 to many")
    er.link("source", "job", "1 to many", start_side="b", end_side="t")
    er.link("source", "file", "1 to many")
    er.link("source", "schedule", start_side="r", end_side="l", corners=((972, 70), (972, 228)))
    er.link("job", "backup", "1 to 0–1", start_side="b", end_side="t")
    er.link("backup", "restoration", "1 to many")
    er.link("backup", "test", start_side="r", end_side="l", corners=((972, 408), (972, 572)))
    paths["er"] = er.save(directory / "er.png")
    return paths


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--evidence", type=Path)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args()
    default_evidence = Path(__file__).with_name("generate-report-evidence.json")
    evidence_path = args.evidence or (default_evidence if default_evidence.exists() else None)
    evidence = json.loads(evidence_path.read_text(encoding="utf-8-sig")) if evidence_path else {}
    with tempfile.TemporaryDirectory(prefix="backup-report-") as directory:
        report = Report(make_diagrams(Path(directory)), evidence)
        report.save(args.output)
    print(args.output.resolve())


if __name__ == "__main__":
    main()
