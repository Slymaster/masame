# Preparing a SignPath Foundation application

Status: not submitted or accepted. Masame releases remain unsigned on Windows. This document is a preparation
checklist, not an announcement of sponsorship. No external request or upload has been made by this change.

SignPath Foundation provides free code signing for eligible open-source projects. Masame's public MIT repository,
existing releases and GitHub Actions builds make it a plausible candidate. Acceptance requires an external review;
no guaranteed application turnaround is published in the official pages checked on 2026-11-11.

## Application draft for maintainer review

This is an unsent draft. Statements below identify the project and proposed signing scope; they do not assert an
accepted sponsorship or authorize a submission.

| Application field | Proposed content |
| --- | --- |
| Project | Masame |
| Public repository | https://github.com/Slymaster/masame |
| Project description | Free desktop Go board and teaching application. It uses KataGo for local CPU/GPU analysis and human-style play, supports French and English, and optionally connects to Online-Go.com. |
| Repository license | MIT, as stated in the repository LICENSE. Third-party binaries, assets and models have their own licenses, documented in THIRD_PARTY_NOTICES.md. |
| Current released version | 0.7.0, tag v0.7.0. |
| Download page | https://github.com/Slymaster/masame/releases/latest |
| Maintainer account | GitHub account Slymaster. Legal applicant/contact and signing-account owner must be confirmed by the maintainer. |
| Authors, reviewers, approvers | Proposed initial contact: Slymaster. Exact signing roles, additional members if any, approval authority and MFA status remain to be confirmed. No team membership or legal ownership is inferred here. |
| Requested platform | Windows x64, built by GitHub Actions on Windows. |
| Requested signed files | Masame's own `masame.exe`; NSIS `Masame_0.7.0_x64-setup.exe` (versioned equivalently for future releases); its generated uninstaller only if included in the approved artifact policy. Exact generated-uninstaller artifact mapping must be agreed before enabling signing. |
| Build provenance | `.github/workflows/build.yml` builds Windows NSIS from the public repository. Its separate tag-only release job verifies updater signatures and creates a draft release for maintainer review. The intended integration accepts only approved release refs and a verifiable GitHub build artifact. |
| Validation | `.github/workflows/windows-reliability.yml` installs NSIS and exercises the actual installed WebView2 via WebDriver, reinstallation, retained data, missing resources, and signed loopback updates. The updater scenario uses official CPU KataGo plus a SHA256/size-verified 14 MB Compact model for real analysis before and after updating. This describes the suite; its latest CI result must be attached and reviewed before applying, not presumed successful. |
| Upstream components excluded from signing | Official KataGo Windows EXEs and accompanying DLLs downloaded by `scripts/fetch-windows-engine.ps1`, pinned by size/SHA256. They remain third-party payloads inside the installer, outside the requested Masame Authenticode signing scope. |
| Model licensing | The app downloads neural networks under the KataGo Neural Network License. Models are not Masame source under MIT. The shipped/generated content, optional downloaded models and their license compatibility must be disclosed for eligibility review. |
| Network/privacy description to review | Optional OGS account/game traffic, network-catalog/model downloads and update checks are described by the app. Automatic update checks are on by default and configurable. No claim that the program transfers data only after an individual explicit request is made. The maintainer must approve a complete privacy statement covering these behaviors and third-party services. |

Proposed application message, ready for review and completion:

> Please review Masame for the SignPath Foundation open-source signing program. The public MIT repository is
> https://github.com/Slymaster/masame and the current release is v0.7.0. I am contacting you as [maintainer's confirmed
> name and role], associated with GitHub account Slymaster. We request Authenticode signing for our own Windows
> `masame.exe` and versioned NSIS installer, with generated-uninstaller coverage only as approved by your policy.
> Our GitHub Actions builds provide source/build provenance and a separate draft-release review. The attached
> CI evidence will identify which installation, real CPU inference and updater tests passed. Upstream KataGo
> EXEs/DLLs and downloaded neural networks have separate licenses and are excluded from our own-binary signing
> request. We would like confirmation of their eligibility as packaged/dependent components. Proposed authors,
> reviewers, release approvers, MFA confirmation and the reviewed privacy/signing policy are [to be completed].

## Proposed public signing policy text (unsent draft)

The following is a draft for review inside this document only. It has not been published as the project's active
policy and does not claim that SignPath provides a service to Masame today.

> **Code signing policy**
>
> Status: Masame's Windows releases currently have no Authenticode signature. No SignPath Foundation application
> has been submitted or accepted. Updater minisign signatures are separate and remain mandatory.
>
> Proposed scope after acceptance: the Masame executable, versioned Windows NSIS installer and any generated
> uninstaller explicitly covered by the approved artifact policy. The signing service would accept only artifacts
> with verified provenance from this repository's approved release builds. Every signing request would require
> approval from a named, authorized release approver. Upstream KataGo executables/DLLs and downloaded networks
> would keep their own licensing and would not be signed as Masame's own code.
>
> Authors/reviewers/approvers: [maintainer to confirm named roles and MFA; GitHub account Slymaster is the proposed
> initial contact]. Privacy statement: [maintainer-reviewed URL/text covering automatic update checks, model/catalog
> downloads, optional OGS traffic and relevant third-party services].
>
> After acceptance and before the first signed release, the maintainer would replace this status with the actual
> service/certificate scope, approved roles and required attribution: "Free code signing provided by SignPath.io,
> certificate by SignPath Foundation." That attribution must not be used as a current sponsorship claim today.
>
> A valid Authenticode signature identifies the approved publisher and protects artifact integrity. It does not
> guarantee that Avira or SmartScreen will accept a file. No antivirus bypass is part of this policy.

Remaining maintainer decisions before any submission: legal applicant/contact and signing-account owner; named
roles/approvers and MFA status; the privacy statement; third-party/model eligibility; and exact generated-uninstaller
coverage. These are deliberately unfilled rather than inferred from the repository account or GUARANI LLC name.

## Integration preparation

Before applying, a maintainer must:

1. Review eligibility for the entire shipped product and its components. SignPath requires an OSI-approved license,
   active maintenance, released/documented functionality and no proprietary components outside allowed system
   libraries. The neural-network licensing and downloaded models should be disclosed rather than assuming that
   the repository's MIT license covers every component.
2. Enable MFA for everyone with source-repository and signing access. Name the authors/reviewers and trusted
   release approvers. Every release requires manual signing approval under the Foundation conditions.
3. Publish a truthful **Code signing policy** on the project/download page with team roles, privacy information and,
   only after acceptance, the required attribution to SignPath.io and SignPath Foundation. The Foundation certificate
   identifies SignPath Foundation as publisher, not GUARANI LLC.
4. Configure trusted GitHub Actions build provenance, allowed release refs and expected product/version metadata.
   Define the exact artifacts to sign. Sign Masame's executable and NSIS installer, including the generated uninstaller
   when supported by the approved policy. Verify the resulting Authenticode chain and timestamp on Windows.
5. Keep upstream KataGo executables and DLLs outside the Masame signing request. The terms permit unsigned
   upstream OSS files inside signed packages, but forbid using the project certificate to sign upstream binaries as
   though they were Masame's own code. Disclose them in the application. A quarantine of `katago.exe` can remain
   even when Masame and its installer are signed.
6. Integrate the accepted signing service before producing the updater's minisign signature and checksums. Any
   Authenticode modification after minisign signing invalidates the updater signature. Verify both signatures, and
   preserve the existing draft-release review before publication.

The application and future per-release signing requests are explicit external actions for the maintainer. No disabled
or placeholder signing job is added: a missing service is not represented as successful signing. Do not promise that
Authenticode eliminates Avira detections or SmartScreen warnings.

Azure Artifact Signing is a paid alternative, not a free fallback. Its current FAQ excludes free, trial and sponsored
subscriptions. Basic is publicly listed at USD 9.99/month. An eligible-country legal entity such as a qualifying US LLC
must still complete organization and representative validation. The name GUARANI LLC alone establishes neither
its jurisdiction nor eligibility. The current quickstart gives 1 to 20 business days (possibly longer) for validation and
does not publish a general three-year minimum. No Azure account, resource or expenditure is created here.

Official sources:

- [SignPath Foundation](https://signpath.org/)
- [Foundation conditions (currently marked draft)](https://signpath.org/terms)
- [SignPath project and provenance configuration](https://docs.signpath.io/projects)
- [Azure Artifact Signing FAQ](https://learn.microsoft.com/en-us/azure/artifact-signing/faq)
- [Azure identity requirements](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart)
- [Azure plans](https://azure.microsoft.com/en-us/products/artifact-signing)
