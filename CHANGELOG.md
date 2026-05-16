# Changelog

## [0.1.15](https://github.com/DahliaWitt/braket-tickets/compare/v0.1.14...v0.1.15) (2026-05-16)

### Bug Fixes

- **admin:** restore reusable magic link actions ([#77](https://github.com/DahliaWitt/braket-tickets/issues/77)) ([b25c032](https://github.com/DahliaWitt/braket-tickets/commit/b25c03293286977fa64dd252dbd27df5ee2cf116))
- **admin:** restore reusable magic link actions ([#77](https://github.com/DahliaWitt/braket-tickets/issues/77)) ([#78](https://github.com/DahliaWitt/braket-tickets/issues/78)) ([6cfad60](https://github.com/DahliaWitt/braket-tickets/commit/6cfad60cbde31a37a8a0ebad35bc0e45d1cfd9de))

## [0.1.14](https://github.com/DahliaWitt/braket-tickets/compare/v0.1.13...v0.1.14) (2026-05-15)

### Features

- **vetting:** surface rejected application resubmission ([#74](https://github.com/DahliaWitt/braket-tickets/issues/74)) ([15529ec](https://github.com/DahliaWitt/braket-tickets/commit/15529ec188211b739cea257c49349187c091cdb8))

### Bug Fixes

- **admin:** add magic link copy affordance ([#70](https://github.com/DahliaWitt/braket-tickets/issues/70)) ([2b0e28d](https://github.com/DahliaWitt/braket-tickets/commit/2b0e28d064ae38e4d9020c83679770ece17f08e9))
- **orders:** prevent stale checkout holds ([#73](https://github.com/DahliaWitt/braket-tickets/issues/73)) ([8e6a66a](https://github.com/DahliaWitt/braket-tickets/commit/8e6a66ae6302e0623765af5838e0cec71bf9c4e2))
- **vetting:** update application prompt copy ([#71](https://github.com/DahliaWitt/braket-tickets/issues/71)) ([f5d0d36](https://github.com/DahliaWitt/braket-tickets/commit/f5d0d369a8222ccf5d2cd26b6c2e0aba724a3153))

### Code Refactoring

- **analytics:** remove PostHog ([#72](https://github.com/DahliaWitt/braket-tickets/issues/72)) ([67e6046](https://github.com/DahliaWitt/braket-tickets/commit/67e6046b5d5d3a06b705ff87798ed5fef61a5c25))

## [0.1.13](https://github.com/DahliaWitt/braket-tickets/compare/v0.1.12...v0.1.13) (2026-05-12)

### Features

- **events:** unify event listing to horizontal row layout ([#63](https://github.com/DahliaWitt/braket-tickets/issues/63)) ([3d254e2](https://github.com/DahliaWitt/braket-tickets/commit/3d254e23a0fea9488519392298ae4abcef01e392))
- **feedback:** use sentry feedback form ([#66](https://github.com/DahliaWitt/braket-tickets/issues/66)) ([f17100c](https://github.com/DahliaWitt/braket-tickets/commit/f17100c368d9486a2fc8939dc86966890a99da9b))

### Bug Fixes

- **email:** use LA time for vetting notifications ([#60](https://github.com/DahliaWitt/braket-tickets/issues/60)) ([f32d2ee](https://github.com/DahliaWitt/braket-tickets/commit/f32d2eeeaf8c7fa82ad55ad1dc6a07dd8b2642e0))
- **events:** preserve Los Angeles event times ([#62](https://github.com/DahliaWitt/braket-tickets/issues/62)) ([df38740](https://github.com/DahliaWitt/braket-tickets/commit/df38740b0f2c9a5ecc43d37ee5edb9ec581aa3b4))
- **frontend:** prevent stale bundle html fallbacks ([#67](https://github.com/DahliaWitt/braket-tickets/issues/67)) ([b074aff](https://github.com/DahliaWitt/braket-tickets/commit/b074affeb6cbf240d9c4fbd3adab399650d6e10a))
- **frontend:** suppress optional Sentry replay load failures ([#65](https://github.com/DahliaWitt/braket-tickets/issues/65)) ([3ba8e04](https://github.com/DahliaWitt/braket-tickets/commit/3ba8e041605e8cb1faf6494b91c3565db0b0abd9))

## [0.1.12](https://github.com/DahliaWitt/braket-tickets/compare/v0.1.11...v0.1.12) (2026-05-12)

### Bug Fixes

- **tickets:** simplify buyer pricing copy ([8823482](https://github.com/DahliaWitt/braket-tickets/commit/88234826ee765099630599b2f5bd0c3fc4d972b9))

## [0.1.11](https://github.com/DahliaWitt/braket-tickets/compare/v0.1.10...v0.1.11) (2026-05-11)

### Features

- **pricing:** align buyer-facing ticket pricing ([#51](https://github.com/DahliaWitt/braket-tickets/issues/51)) ([3ae0dd6](https://github.com/DahliaWitt/braket-tickets/commit/3ae0dd654eb85a694f8193dcd1fd8256908886f6))

### Bug Fixes

- **analytics:** allow feedback with privacy signals ([#50](https://github.com/DahliaWitt/braket-tickets/issues/50)) ([351b54f](https://github.com/DahliaWitt/braket-tickets/commit/351b54ff2a7ea3d050d12f8877996995582a5122))
- **dropdown:** per-trigger aria-expanded state ([#53](https://github.com/DahliaWitt/braket-tickets/issues/53)) ([af4151a](https://github.com/DahliaWitt/braket-tickets/commit/af4151a187c734d6085489a582911eb1e8b550df))
- **help:** defer admin help guard until auth settles ([#55](https://github.com/DahliaWitt/braket-tickets/issues/55)) ([4b707b1](https://github.com/DahliaWitt/braket-tickets/commit/4b707b11c1316d726d954a6803ce0f96c07098b2))

### Code Refactoring

- **frontend:** centralize harness polling waits ([3ec3442](https://github.com/DahliaWitt/braket-tickets/commit/3ec3442362b229ec02c41990ffec86e96a72a7f2))
- **frontend:** centralize harness polling waits ([#49](https://github.com/DahliaWitt/braket-tickets/issues/49)) ([9b75aab](https://github.com/DahliaWitt/braket-tickets/commit/9b75aab61fccde3f3817a54d97680ae771936f84))
- **ui:** migrate hand-written status badges to bra-status-badge ([#52](https://github.com/DahliaWitt/braket-tickets/issues/52)) ([4679b3d](https://github.com/DahliaWitt/braket-tickets/commit/4679b3d573cdacb7ff569ddf975a05eb4757b45f))

### Documentation

- **e2e:** refresh authoring test APIs ([#48](https://github.com/DahliaWitt/braket-tickets/issues/48)) ([fc9757d](https://github.com/DahliaWitt/braket-tickets/commit/fc9757d5def382eec91ef302ea3ca3bdd2acbc2d))
- **legal:** update privacy and terms policies ([f874ad8](https://github.com/DahliaWitt/braket-tickets/commit/f874ad8239f9803706ced9a900ab346b94f65216))

## [0.1.10](https://github.com/DahliaWitt/braket-tickets/compare/v0.1.9...v0.1.10) (2026-05-11)

### Documentation

- **ci:** document release merge policy ([#43](https://github.com/DahliaWitt/braket-tickets/issues/43)) ([6b8681f](https://github.com/DahliaWitt/braket-tickets/commit/6b8681fcfd1a9fc1691676c661c1e24501ccb778))

## [0.1.9](https://github.com/DahliaWitt/braket-tickets/compare/v0.1.8...v0.1.9) (2026-05-11)

### Features

- **admin:** add search filtering to applications and members tables ([48bdcfd](https://github.com/DahliaWitt/braket-tickets/commit/48bdcfd278992331ea34f51f5be299705186134c)), closes [#27](https://github.com/DahliaWitt/braket-tickets/issues/27)
- **audit:** add targetUserId to audit log for role grant/revoke ([#32](https://github.com/DahliaWitt/braket-tickets/issues/32)) ([2fb3110](https://github.com/DahliaWitt/braket-tickets/commit/2fb31109b778a8ecac470a571fcbb0f640e0b636))
- **frontend:** wire NgOptimizedImage with Cloudflare image transformations ([59fccb9](https://github.com/DahliaWitt/braket-tickets/commit/59fccb9523d9784d388809ffc9fa4cf3532635ab))
- **ops:** forward Convex logs to both sinks ([7048eb8](https://github.com/DahliaWitt/braket-tickets/commit/7048eb8f1e66a4b6171f72050297aef2f16e3b23))
- **ops:** forward Convex logs to both sinks ([f68337a](https://github.com/DahliaWitt/braket-tickets/commit/f68337ad2779e91ea850a9746ef3594240bec853))
- **tickets:** surface code of conduct across event pages and emails ([#31](https://github.com/DahliaWitt/braket-tickets/issues/31)) ([d51dcb5](https://github.com/DahliaWitt/braket-tickets/commit/d51dcb5f7c20578dbe4cc698e62ea7c192191262))
- **ui:** add bra-community-avatar shared component ([efdc03f](https://github.com/DahliaWitt/braket-tickets/commit/efdc03fdc9872f81a5ac3d936aafcba837fefb03))
- **ui:** add bra-community-avatar shared component ([d0b54a1](https://github.com/DahliaWitt/braket-tickets/commit/d0b54a1b7984abf9bce3c2efc15a50c7490bb95e))
- **vetting:** add reinstate button for revoked memberships ([#35](https://github.com/DahliaWitt/braket-tickets/issues/35)) ([7425941](https://github.com/DahliaWitt/braket-tickets/commit/74259414d92f762a94b71e362d0eb1a655b19262))

### Bug Fixes

- **admin:** cascade admin role revocation when revoking membership ([#36](https://github.com/DahliaWitt/braket-tickets/issues/36)) ([e09104e](https://github.com/DahliaWitt/braket-tickets/commit/e09104e635e0443ef225320562e76a8814d816f2)), closes [#25](https://github.com/DahliaWitt/braket-tickets/issues/25)
- **admin:** move members search to server-side Convex query ([1c24326](https://github.com/DahliaWitt/braket-tickets/commit/1c2432648d45eb9c22a30e00e50bcc7cd2621412))
- **admin:** resolve team roles by existing users ([#34](https://github.com/DahliaWitt/braket-tickets/issues/34)) ([5de7e91](https://github.com/DahliaWitt/braket-tickets/commit/5de7e91980ad19b961ae327e79d0b00ae6d34815))
- **admin:** stream member search through directory to eliminate pre-scope cap ([ad5451d](https://github.com/DahliaWitt/braket-tickets/commit/ad5451dea0ce4754a45084bf76baabd2658b25b8))
- **admin:** use CDK harness throughout applications-table specs ([bf2bb55](https://github.com/DahliaWitt/braket-tickets/commit/bf2bb5514b00166b3fca8a0e0606e2a62e8bd203))
- **analytics:** harden posthog cookie scope ([199be16](https://github.com/DahliaWitt/braket-tickets/commit/199be167c44c0064f068aec01f8fb03fafa2ad0c))
- **analytics:** send feedback through PostHog ([209e3bd](https://github.com/DahliaWitt/braket-tickets/commit/209e3bd1dc532944005ac5245f3a28d5ef520daf))
- **ci:** call deploy workflows directly ([44362e6](https://github.com/DahliaWitt/braket-tickets/commit/44362e6e750df05bcb70e2496ee9d9e4061c3477))
- **ci:** split release please token usage ([#42](https://github.com/DahliaWitt/braket-tickets/issues/42)) ([070bdb9](https://github.com/DahliaWitt/braket-tickets/commit/070bdb907db3f9ab89d36462f2f252f0fa73e7a1))
- **convex:** address static-analysis findings across backend ([#11](https://github.com/DahliaWitt/braket-tickets/issues/11)) ([c932afd](https://github.com/DahliaWitt/braket-tickets/commit/c932afd36fc786d0b8e8b7efe947cc31ca2474eb))
- **dashboard:** add a11y attrs to truncated nav labels and lock down responsive assertions ([3901bdb](https://github.com/DahliaWitt/braket-tickets/commit/3901bdbd53fa12d2fd7aa0cd100ffa685216c040))
- **dashboard:** replace horizontal tab scroll with vertical nav rail ([cf54479](https://github.com/DahliaWitt/braket-tickets/commit/cf54479e790c028882287c8018b6c46ae5d8ab01))
- **dashboard:** replace horizontal tab scroll with vertical nav rail ([2c334c7](https://github.com/DahliaWitt/braket-tickets/commit/2c334c760a276bd2f6d2de82529b873210b8291f))
- **dashboard:** resolve duplicate class binding ([6ce2eba](https://github.com/DahliaWitt/braket-tickets/commit/6ce2eba2bb253e64a0325867e6976f2677f5a369))
- **dashboard:** resolve duplicate class binding ([357f96c](https://github.com/DahliaWitt/braket-tickets/commit/357f96cf45a7ced30985ead0ac8470f9b38ce8de))
- **dashboard:** show community logos instead of fallback initials ([d7b49cf](https://github.com/DahliaWitt/braket-tickets/commit/d7b49cf8e8fc012b536ffef3ba51ef02aa79fdc1))
- **dashboard:** show community logos instead of fallback initials ([4c247cc](https://github.com/DahliaWitt/braket-tickets/commit/4c247cc6364bdb2aa0e4bf2594bf03bdfa9575b8))
- **docs:** correct accuracy issues from PR review ([122a439](https://github.com/DahliaWitt/braket-tickets/commit/122a4398ac7aff0a9b4924921872815b2eeb6056))
- **email:** pass isGuest=true in guest ticket email ([#37](https://github.com/DahliaWitt/braket-tickets/issues/37)) ([39f2968](https://github.com/DahliaWitt/braket-tickets/commit/39f29683b686895721a0f494a5ffeb65f250f4eb))
- **event-card:** add buy=true query param to ticket buttons ([#33](https://github.com/DahliaWitt/braket-tickets/issues/33)) ([217e875](https://github.com/DahliaWitt/braket-tickets/commit/217e8757fbd936c9f337bafcd56d79d26ef0c47d))
- **frontend:** add missing aria-label to member approve button ([64b1baa](https://github.com/DahliaWitt/braket-tickets/commit/64b1baa705c33b4d4eddddf8c05ad21632bdae6a))
- **frontend:** address monitoring review findings ([bf9e72e](https://github.com/DahliaWitt/braket-tickets/commit/bf9e72e1936107836774a700e0475e1906e70a9e))
- **frontend:** display event times alongside dates ([5a067bf](https://github.com/DahliaWitt/braket-tickets/commit/5a067bf52982631594f8ec25bbdc2320c1b2401c))
- **frontend:** display event times alongside dates across all surfaces ([76c5922](https://github.com/DahliaWitt/braket-tickets/commit/76c59220ff82cf029b08a7e3f3b304fd362ca867))
- **frontend:** finish event time display PR ([919d1d4](https://github.com/DahliaWitt/braket-tickets/commit/919d1d4ad755ca93609920e75cac9dcc04c0464b))
- **frontend:** resolve docstring PR feedback ([435d14b](https://github.com/DahliaWitt/braket-tickets/commit/435d14b915e904e05c1fb90045c97aaeb5c3142f))
- **frontend:** restore scroll position on route changes ([#26](https://github.com/DahliaWitt/braket-tickets/issues/26)) ([aaeda0b](https://github.com/DahliaWitt/braket-tickets/commit/aaeda0ba47896c13e1e51dc16f90dc5684cedb38))
- **frontend:** show landing page instead of dashboard after logout ([d63f680](https://github.com/DahliaWitt/braket-tickets/commit/d63f6805a1caa1fb8a336027ff0df96095dd6890))
- **scripts:** reinject doppler for nested config switches ([6d0311c](https://github.com/DahliaWitt/braket-tickets/commit/6d0311cf0bcbedcb400a39689c96e8744f9a1a64))
- **static-analysis:** address audit findings ([3cb10a4](https://github.com/DahliaWitt/braket-tickets/commit/3cb10a431d5de775494cc4df20ebb14af4689e70))
- **storybook:** dedupe react/react-dom to unblock docs rendering ([d4bdf45](https://github.com/DahliaWitt/braket-tickets/commit/d4bdf45e00084756a695f787a335884bbfa6b0b7))
- **storybook:** enable GFM in addon-docs for MDX pipe-tables ([0b29723](https://github.com/DahliaWitt/braket-tickets/commit/0b297236b5090d2224c4500d36874786da250ed9))
- **tickets:** stop auto-opening checkout sidebar on event navigation ([6d01552](https://github.com/DahliaWitt/braket-tickets/commit/6d015522021f90aa0cb47ed3606934e15d16365f))
- **tooling:** configure Convex generated check env ([a148a08](https://github.com/DahliaWitt/braket-tickets/commit/a148a085cbe840e74bfe5ee7626e5ae843a3e913))
- **ui:** resolve avatar PR feedback ([3868965](https://github.com/DahliaWitt/braket-tickets/commit/3868965b565be1b0c5a6fe954d2fd87e43160176))

### Performance

- **admin:** parallelize directory lookups in member search ([43802cb](https://github.com/DahliaWitt/braket-tickets/commit/43802cbae7715445481612a099082e4c21c4221a))
- **frontend:** trim initial app bundle ([ce9e84f](https://github.com/DahliaWitt/braket-tickets/commit/ce9e84f9ca1c0c4936800fef52629664b0b402a5))
- **frontend:** trim initial app bundle ([7169f84](https://github.com/DahliaWitt/braket-tickets/commit/7169f84d815674f17784b0676330b2e4f7eac492))

### Code Refactoring

- **dashboard:** extract community avatar into ng-template ([4b879e9](https://github.com/DahliaWitt/braket-tickets/commit/4b879e9a40bda2b269c3a6199a12c6ebeea1da11))

### Documentation

- add dark mode screenshots to README ([aa22085](https://github.com/DahliaWitt/braket-tickets/commit/aa22085735520ed443fa55d47f3271e9335925c5))
- add dark mode screenshots to README ([2f841e9](https://github.com/DahliaWitt/braket-tickets/commit/2f841e909cf163ef67077c50cb9d22c85074b613))
- **ci:** document release merge policy ([3c41a19](https://github.com/DahliaWitt/braket-tickets/commit/3c41a19019b9e1a1a9917d7a0a952cfd8580fb3f))
- **cujs:** rewrite as goal-centric inventory grounded in code ([57b993e](https://github.com/DahliaWitt/braket-tickets/commit/57b993e5494cdf824746c5eaa816d94dbd71e849))
- overhaul help documentation for users and admins ([bc95066](https://github.com/DahliaWitt/braket-tickets/commit/bc950668b49d05640a41051672d2cb59c6d2f78c))
- **skills:** skip worktree creation when already inside a worktree ([60a1ad8](https://github.com/DahliaWitt/braket-tickets/commit/60a1ad891f493974e48c1387b2b1ab5f8c270211))

### CI/CD

- **release:** automate release please PR merging ([807a925](https://github.com/DahliaWitt/braket-tickets/commit/807a9252db0e321f762a9c1c805ac7e68a1f4323))
- route fork PRs to GitHub-hosted runners ([1b0a6c2](https://github.com/DahliaWitt/braket-tickets/commit/1b0a6c2e538296cb86e288a9b5eb9289863f0c84))

## [0.1.8](https://github.com/DahliaWitt/braket-tickets/compare/v0.1.7...v0.1.8) (2026-05-09)

### Features

- **ops:** forward Convex logs to both sinks ([f68337a](https://github.com/DahliaWitt/braket-tickets/commit/f68337ad2779e91ea850a9746ef3594240bec853))
- **ui:** add bra-community-avatar shared component ([d0b54a1](https://github.com/DahliaWitt/braket-tickets/commit/d0b54a1b7984abf9bce3c2efc15a50c7490bb95e))

### Bug Fixes

- **dashboard:** add a11y attrs to truncated nav labels and lock down responsive assertions ([3901bdb](https://github.com/DahliaWitt/braket-tickets/commit/3901bdbd53fa12d2fd7aa0cd100ffa685216c040))
- **dashboard:** replace horizontal tab scroll with vertical nav rail ([2c334c7](https://github.com/DahliaWitt/braket-tickets/commit/2c334c760a276bd2f6d2de82529b873210b8291f))
- **dashboard:** resolve duplicate class binding ([357f96c](https://github.com/DahliaWitt/braket-tickets/commit/357f96cf45a7ced30985ead0ac8470f9b38ce8de))
- **frontend:** address monitoring review findings ([bf9e72e](https://github.com/DahliaWitt/braket-tickets/commit/bf9e72e1936107836774a700e0475e1906e70a9e))
- **frontend:** display event times alongside dates ([5a067bf](https://github.com/DahliaWitt/braket-tickets/commit/5a067bf52982631594f8ec25bbdc2320c1b2401c))
- **frontend:** display event times alongside dates across all surfaces ([76c5922](https://github.com/DahliaWitt/braket-tickets/commit/76c59220ff82cf029b08a7e3f3b304fd362ca867))
- **frontend:** finish event time display PR ([919d1d4](https://github.com/DahliaWitt/braket-tickets/commit/919d1d4ad755ca93609920e75cac9dcc04c0464b))
- **frontend:** resolve docstring PR feedback ([435d14b](https://github.com/DahliaWitt/braket-tickets/commit/435d14b915e904e05c1fb90045c97aaeb5c3142f))
- **tickets:** stop auto-opening checkout sidebar on event navigation ([6d01552](https://github.com/DahliaWitt/braket-tickets/commit/6d015522021f90aa0cb47ed3606934e15d16365f))
- **ui:** resolve avatar PR feedback ([3868965](https://github.com/DahliaWitt/braket-tickets/commit/3868965b565be1b0c5a6fe954d2fd87e43160176))

### Performance

- **frontend:** trim initial app bundle ([ce9e84f](https://github.com/DahliaWitt/braket-tickets/commit/ce9e84f9ca1c0c4936800fef52629664b0b402a5))

### Documentation

- add dark mode screenshots to README ([2f841e9](https://github.com/DahliaWitt/braket-tickets/commit/2f841e909cf163ef67077c50cb9d22c85074b613))

## [0.1.7](https://github.com/DahliaWitt/braket-tickets/compare/v0.1.6...v0.1.7) (2026-05-09)

### Bug Fixes

- **dashboard:** show community logos instead of fallback initials ([d7b49cf](https://github.com/DahliaWitt/braket-tickets/commit/d7b49cf8e8fc012b536ffef3ba51ef02aa79fdc1))
- **dashboard:** show community logos instead of fallback initials ([4c247cc](https://github.com/DahliaWitt/braket-tickets/commit/4c247cc6364bdb2aa0e4bf2594bf03bdfa9575b8))
- **frontend:** add missing aria-label to member approve button ([64b1baa](https://github.com/DahliaWitt/braket-tickets/commit/64b1baa705c33b4d4eddddf8c05ad21632bdae6a))
- **frontend:** show landing page instead of dashboard after logout ([d63f680](https://github.com/DahliaWitt/braket-tickets/commit/d63f6805a1caa1fb8a336027ff0df96095dd6890))

### Code Refactoring

- **dashboard:** extract community avatar into ng-template ([4b879e9](https://github.com/DahliaWitt/braket-tickets/commit/4b879e9a40bda2b269c3a6199a12c6ebeea1da11))

### CI/CD

- route fork PRs to GitHub-hosted runners ([1b0a6c2](https://github.com/DahliaWitt/braket-tickets/commit/1b0a6c2e538296cb86e288a9b5eb9289863f0c84))

## [0.1.6](https://github.com/DahliaWitt/braket-tickets/compare/v0.1.5...v0.1.6) (2026-05-08)

### Bug Fixes

- **dashboard:** attach empty state to featuredEvent gate, not overflow ([7d566a4](https://github.com/DahliaWitt/braket-tickets/commit/7d566a41414b74ac295b348510b522435ca18bee))
- **dashboard:** attach empty state to featuredEvent gate, not overflow ([9db44ec](https://github.com/DahliaWitt/braket-tickets/commit/9db44ec38cfb190a6910e91f153c68f041bccba7))

## [0.1.5](https://github.com/DahliaWitt/braket-tickets/compare/v0.1.4...v0.1.5) (2026-05-07)

### Features

- **seed:** gate remote seeding with token sessions ([0c66db6](https://github.com/DahliaWitt/braket-tickets/commit/0c66db6af01cb25f40eaaea3d72bb714f8fb6bce))
- **seed:** gate remote seeding with token sessions ([ab86e72](https://github.com/DahliaWitt/braket-tickets/commit/ab86e72f812122ded6f7eb9d2d08812110add90f))

### Bug Fixes

- **ci:** move resolveValidationBaseRef to standalone module ([696a38c](https://github.com/DahliaWitt/braket-tickets/commit/696a38ce025c995b5e83e01a221f7aa6af63c235))
- **events:** harden ticket purchase reminder against send abuse ([4f7ecc5](https://github.com/DahliaWitt/braket-tickets/commit/4f7ecc5b2476daf21959c455ddf971218e364983))
- **events:** harden ticket purchase reminder against send abuse and transaction limits ([343fbaa](https://github.com/DahliaWitt/braket-tickets/commit/343fbaa3333f0b506f99b33c52ee3911a6b10951))
- **events:** remove unused Doc import and cap order scan by rows ([a079124](https://github.com/DahliaWitt/braket-tickets/commit/a07912418eedc628df780ad7519c917d76de62b8))
- **marketing:** avoid organizer-wide preference scans in batches ([855918f](https://github.com/DahliaWitt/braket-tickets/commit/855918fc1d9f62c49da0b3dfc296685ca5bdc2b8))
- **ops:** sanitize forwarded Convex logs ([f4bce72](https://github.com/DahliaWitt/braket-tickets/commit/f4bce72863072b25857dfd07419fca4fccb70f31))
- **orders:** rate limit free ticket claims ([2c7759f](https://github.com/DahliaWitt/braket-tickets/commit/2c7759f4a702e8dcaba1164f73fafd59075889be))
- **orders:** rate limit free ticket claims ([3f18470](https://github.com/DahliaWitt/braket-tickets/commit/3f18470736b6d2b726f4c9a45ec82f351142e9bd))
- **scripts:** generate e2e jwt keys at runtime ([813cba3](https://github.com/DahliaWitt/braket-tickets/commit/813cba3199761d41fee6460a1b261d275d482a4f))
- **scripts:** generate e2e jwt keys at runtime ([3b09757](https://github.com/DahliaWitt/braket-tickets/commit/3b09757c965a761dee7e980a7a17d653dfae0524))
- **scripts:** scope pre-push validation diff to pushed commits only ([2f2c4b3](https://github.com/DahliaWitt/braket-tickets/commit/2f2c4b398b4403f5be3debbf52628f0f321478ac))
- **security:** address token hardening review feedback ([7121308](https://github.com/DahliaWitt/braket-tickets/commit/7121308f8af0a3c05e33f8db4835b5dfb4914673))
- **security:** harden bearer token storage ([91e96c6](https://github.com/DahliaWitt/braket-tickets/commit/91e96c623a24377ccca559ddde6d12b71d8e472f))
- **security:** harden bearer token storage ([eb756b2](https://github.com/DahliaWitt/braket-tickets/commit/eb756b294a2448b959c883a95dbe7370f07d7ac9))
- **storage:** enforce blob size limit and clean up replaced uploads ([c698ad4](https://github.com/DahliaWitt/braket-tickets/commit/c698ad49e4a169c08b1e261a40894d98f654388c))
- **storage:** enforce blob size limit in confirmUpload and clean up replaced uploads ([fd84b9e](https://github.com/DahliaWitt/braket-tickets/commit/fd84b9e96698ca5850b8fdd0da3824e01576eaa7))
- **storage:** remove unused variable in cleanup test ([2008cb5](https://github.com/DahliaWitt/braket-tickets/commit/2008cb51acadca126f15f99d148af54dc276b2f6))
- **tests:** stabilize flaky getSession call count in auth service spec ([12e33c4](https://github.com/DahliaWitt/braket-tickets/commit/12e33c4af8c8d9753607c7b4b47c9be9694229a9))

### Performance

- **e2e:** speed up E2E suite startup with bulk env vars, parallel auth, and local workers ([b238a87](https://github.com/DahliaWitt/braket-tickets/commit/b238a87522f864ef317e9c0d978330e0cf0d6d5a))

### Documentation

- **env:** add .env.example and non-Doppler contributor setup ([0e9edf1](https://github.com/DahliaWitt/braket-tickets/commit/0e9edf1dba9d0f89296519f388588cdd6845bf1f))
- **env:** document non-Doppler local dev path for external contributors ([f5aa0f6](https://github.com/DahliaWitt/braket-tickets/commit/f5aa0f6e3cd86f1a75fe0088f5aeb66700e62aa0))
- **legal:** replace CLA bot with inline contributor license grant ([2493296](https://github.com/DahliaWitt/braket-tickets/commit/249329635eac117509af89a71a3b6c55d0174bb5))
- **repo:** polish CONTRIBUTING.md for external contributors ([66a8c5e](https://github.com/DahliaWitt/braket-tickets/commit/66a8c5e16dda1e3e5684c3f307dff040c0cd640b))

## [0.1.4](https://github.com/DahliaWitt/braket-tickets/compare/v0.1.3...v0.1.4) (2026-05-07)

### Bug Fixes

- **auth:** require matching pendingEmail before applying Better Auth email update ([1ccf0f3](https://github.com/DahliaWitt/braket-tickets/commit/1ccf0f3b760cabd333201d9181ca5ba00d32fd8a))
- **stripe:** validate connected account before order webhook actions ([3dcfc45](https://github.com/DahliaWitt/braket-tickets/commit/3dcfc45856ec1a7adef2e08c85619ba16f396932))

## [0.1.3](https://github.com/DahliaWitt/braket-tickets/compare/v0.1.2...v0.1.3) (2026-05-07)

### Bug Fixes

- **ci:** keep e2e pull_request runs on development env ([38c8c9f](https://github.com/DahliaWitt/braket-tickets/commit/38c8c9ffcb03c528bfe13fb9a2558bb7cb540cb1))
- **ci:** keep e2e pull_request runs on development env ([8e1c3d5](https://github.com/DahliaWitt/braket-tickets/commit/8e1c3d58a25ed1cf2628d03132f40ae8c836322d))
- **ci:** sync Resend secrets to Convex deploys ([8b40ea2](https://github.com/DahliaWitt/braket-tickets/commit/8b40ea238d0af8b9d49c218e66453ade5ec87543))
- **frontend:** remove static prerendering ([4aa65a3](https://github.com/DahliaWitt/braket-tickets/commit/4aa65a3fb0a7b9355c42f1a68937ca7d6d2f8d1c))

### Documentation

- **admin:** add Stripe setup guide ([ffad137](https://github.com/DahliaWitt/braket-tickets/commit/ffad1379f30d29c6e5a84fb8a5557743e45461cd))

## [0.1.2](https://github.com/DahliaWitt/braket-tickets/compare/v0.1.1...v0.1.2) (2026-05-07)

### Features

- **ci:** add custom act runner image with pnpm support ([a0e1b71](https://github.com/DahliaWitt/braket-tickets/commit/a0e1b71831d658f22c3a1d53aeadab798e3311fd))
- **e2e:** re-enable WebKit/Safari smoke tests for CI (BRA-112) ([4f0d09e](https://github.com/DahliaWitt/braket-tickets/commit/4f0d09ebe7709b4c305149af664b290029a62dd0))
- **email:** cut over delivery to Resend component ([146437f](https://github.com/DahliaWitt/braket-tickets/commit/146437f7320c2711a6bdf362534f77fa9db1354c))

### Bug Fixes

- **analytics:** preserve PostHog ingest token ([aab65b8](https://github.com/DahliaWitt/braket-tickets/commit/aab65b8330fdbd95b2ceae0df74c8fcdf2c2b5c4))
- **analytics:** strengthen PostHog identity hashes ([35c6075](https://github.com/DahliaWitt/braket-tickets/commit/35c60757d40c9fef29925e3a430eca55dbf883e5))
- **ci:** remove redundant Stripe sandbox verify workflow ([f5bf6a7](https://github.com/DahliaWitt/braket-tickets/commit/f5bf6a79dcdf048fbab3ca86ca6bdb9d0cdd06f4))
- **convex:** break circular module dependency in management handlers ([7eb175f](https://github.com/DahliaWitt/braket-tickets/commit/7eb175fff60a8be8e3223b802cce5321e9c55f2d))
- **convex:** use structured marketing preference error ([992a574](https://github.com/DahliaWitt/braket-tickets/commit/992a574d8b524ea3af9353e9d683a83573a9911f))
- **e2e:** capture immediate auth emails in tests ([542d1d8](https://github.com/DahliaWitt/braket-tickets/commit/542d1d89940cc4337dbdb99ca31918da6f00e9c4))
- **e2e:** handle WebKit navigation interruption in patchGotoDefault ([04dfb8b](https://github.com/DahliaWitt/braket-tickets/commit/04dfb8beb7c9e1db550339741449d23ee19f3d1a))
- **frontend:** update empty-state copy and complete mock data shapes ([9d70ba1](https://github.com/DahliaWitt/braket-tickets/commit/9d70ba164fb4bde2b87563b00f099e03e6a1209d))
- **marketing:** prevent admin opt-out and fix empty preferences for community admins (BRA-446) ([07f0919](https://github.com/DahliaWitt/braket-tickets/commit/07f0919b6a6e8e732cc714584f4079df13375124))
- **ops:** repair convex backup job ([991e4e6](https://github.com/DahliaWitt/braket-tickets/commit/991e4e66bb439413b87ee51625f64e5abd0edc2d))
- resolve all typecheck and lint errors for clean validation ([448d1d5](https://github.com/DahliaWitt/braket-tickets/commit/448d1d5270f2e601ce6c2d5c31cbe7555ca03dcf))

### Code Refactoring

- **architecture:** deepen shared contracts and checkout ownership ([5a5f89d](https://github.com/DahliaWitt/braket-tickets/commit/5a5f89d226115b686a80331e3df7184959d34bf4))
- remove circular dep workarounds now obsolete with inline codegen ([7305173](https://github.com/DahliaWitt/braket-tickets/commit/730517352dbf39c38fb4beac6574aa9cbb679437))

### Documentation

- **agents:** add issue tracker, triage, and domain agent docs ([b2fa4b2](https://github.com/DahliaWitt/braket-tickets/commit/b2fa4b2fec41cad8b328df6ea58b97daa6968741))
- **agents:** add skill pointers for issue tracking, triage, and domain docs ([661bfb8](https://github.com/DahliaWitt/braket-tickets/commit/661bfb8747e625909a6c3481453d1b6307c4e572))
- **ci:** add act setup for local GitHub Actions testing ([0e5007a](https://github.com/DahliaWitt/braket-tickets/commit/0e5007a38fb14d42219150ea3e347b2d1b93709b))
- **ci:** expand .act.secrets.example to cover full CI chain ([71652f4](https://github.com/DahliaWitt/braket-tickets/commit/71652f4e3a9e67817e91b7b826ce80cfaaf0f1ee))
- **ci:** update act runbook with Doppler one-liner for secrets ([a587a5e](https://github.com/DahliaWitt/braket-tickets/commit/a587a5ebdc6cb4aa6cc4bdc19054c07f12af2880))

## [0.1.1](https://github.com/DahliaWitt/braket-tickets/compare/v0.1.0...v0.1.1) (2026-05-04)

### Features

- add marketing reEnableAll and upgrade Stripe v22 ([e0fcf71](https://github.com/DahliaWitt/braket-tickets/commit/e0fcf717d7650cd0e11f51a0de675231f9d9761d))
- **admin:** add unsaved changes navigation guard to community settings ([cf308e6](https://github.com/DahliaWitt/braket-tickets/commit/cf308e6d3338410d4bcbaf9c58dea9784391a737))
- **admin:** upgrade community list skeletons to content-shaped shimmer ([bb3eac4](https://github.com/DahliaWitt/braket-tickets/commit/bb3eac4a5d5b9355ab093ae044df657cdc29e7c3))
- **analytics:** add PostHog launch observability ([ca08fec](https://github.com/DahliaWitt/braket-tickets/commit/ca08fec854af2c0b59ad98d09bab55c80d0594d8))
- **analytics:** add PostHog launch observability ([0642ea8](https://github.com/DahliaWitt/braket-tickets/commit/0642ea8b123db78f40f05705d4a6591dbe492199))
- **communities:** add shimmer skeleton screen to community directory ([bb4bea7](https://github.com/DahliaWitt/braket-tickets/commit/bb4bea77ae1895e4a76421030280aded2c04590b))
- **convex:** add audit category denormalization ([d9f580c](https://github.com/DahliaWitt/braket-tickets/commit/d9f580c5b2b1a4f7c99afa533e7a6a8931cfc2ce))
- **convex:** add organizer directory read model ([9e9f0c6](https://github.com/DahliaWitt/braket-tickets/commit/9e9f0c692b1bd8664e5860edc1c4a17589e282d2))
- **convex:** add prod migration helpers ([f52302e](https://github.com/DahliaWitt/braket-tickets/commit/f52302e66803e1b83d82b678acb5cde230d8fe50))
- **event-management:** surface held-in-checkout capacity with dual-segment meter ([be6ae55](https://github.com/DahliaWitt/braket-tickets/commit/be6ae5555d84f5ed41cdc4e8bda1adc00be390c3))
- **guest-migration:** close ticket_orders, owner-clear, and marketing-prefs gaps ([cc089a1](https://github.com/DahliaWitt/braket-tickets/commit/cc089a181e8aa8cd8257491e5f3624b9d18d1b4d))
- moar fixes and additions ([13542df](https://github.com/DahliaWitt/braket-tickets/commit/13542df1dad14fd2bdd04b60da7cf41f1999b469))
- **skeleton:** add shimmer animation variant to z-skeleton ([da54c18](https://github.com/DahliaWitt/braket-tickets/commit/da54c18c99432954972731cecf846bcb0476fb7d))
- **stripe:** add connect webhook and V2 event destination ([d117afc](https://github.com/DahliaWitt/braket-tickets/commit/d117afc00a3ec7edd1af97e3d1ef701cda6b7aff))
- **stripe:** add V2 schema fields — payout state machine, onboarding status ([f20a7a8](https://github.com/DahliaWitt/braket-tickets/commit/f20a7a8aa40b18e3146c6e66914bb877de6babb6))
- **stripe:** direct charge checkout with platform event branching ([5cd4a22](https://github.com/DahliaWitt/braket-tickets/commit/5cd4a22f48b4d944b93965085d85ace4c2bacbb9))
- **stripe:** direct charge refunds with Stripe-Account header ([a89a822](https://github.com/DahliaWitt/braket-tickets/commit/a89a8227f5e42e46735501e686463c364f37e6ef))
- **stripe:** embedded Connect components replace Express dashboard ([23aa6bc](https://github.com/DahliaWitt/braket-tickets/commit/23aa6bc11ebfd946fe0260defa8c6e61accefb12))
- **stripe:** gate orders on organizer charge readiness ([ac99c91](https://github.com/DahliaWitt/braket-tickets/commit/ac99c91b27b7c40c601b62dc88115ba4c3acfb6e))
- **stripe:** harden Connect onboarding, webhook idempotency, SITE_URL resolver ([3ddcb7d](https://github.com/DahliaWitt/braket-tickets/commit/3ddcb7ddef3d57356db87f43c5f2798dd6e09b98))
- **stripe:** initialize Stripe.js with stripeAccount for direct charges ([f0c9afa](https://github.com/DahliaWitt/braket-tickets/commit/f0c9afa2a5a7696e795913f24dc7f720eb93428d))
- **stripe:** settlement ledger with future-event reserves, FIFO payout allocation ([0c9d057](https://github.com/DahliaWitt/braket-tickets/commit/0c9d057c6422997fcac5d57e15d3ac964bea1dbf))
- **stripe:** V2 account creation, account sessions, remove Express flow ([552e981](https://github.com/DahliaWitt/braket-tickets/commit/552e9818ccc9709fe0b443236768639e52fce5ba))
- **stripe:** V2 webhook handlers — payout confirmation, dispute tracking, onboarding lifecycle ([14c4ae1](https://github.com/DahliaWitt/braket-tickets/commit/14c4ae12e8fc061c4825f43ae10e64acb756cbe7))
- **tickets:** improve community contact flow ([4d7e0ca](https://github.com/DahliaWitt/braket-tickets/commit/4d7e0caa2ac821b39f463a4b22b3b1abd5055189))
- **tickets:** redesign PDF tickets with Swiss-poster typography ([7927d75](https://github.com/DahliaWitt/braket-tickets/commit/7927d7578360882656fd7717e7cb9851c20781b3))

### Bug Fixes

- **a11y:** add aria-pressed to community visibility toggle buttons ([ed184e1](https://github.com/DahliaWitt/braket-tickets/commit/ed184e1200abfb0f13199c99b3da5bbc6b0cf7fb))
- **a11y:** add Escape close and focus restore to checkout dialog ([d982b26](https://github.com/DahliaWitt/braket-tickets/commit/d982b265f628cfa59cb1f312436d50076cf836ef))
- **a11y:** add persistent aria-live region to scanner results ([58be311](https://github.com/DahliaWitt/braket-tickets/commit/58be311b8ccfca5f9cd6b4f20adc480980e26a81))
- **a11y:** add programmatic label associations to community settings form ([1c3abcb](https://github.com/DahliaWitt/braket-tickets/commit/1c3abcb8f58d2dbbc95f17d5bf42a7acc907f8f0))
- **a11y:** conditionally set tabindex on theme dropdown menu items ([61ea9d1](https://github.com/DahliaWitt/braket-tickets/commit/61ea9d1acb7221343cd05453a9289c1791672cd4))
- **a11y:** remove focus trap in header caused by hidden focusable elements ([7767b80](https://github.com/DahliaWitt/braket-tickets/commit/7767b8005a494dbb1e719eef4874e73ba6b97d4b))
- **a11y:** restore focus to hamburger button when mobile menu closes ([db0e69b](https://github.com/DahliaWitt/braket-tickets/commit/db0e69b88d62556edee5c150fec812a7b85fc0b8))
- **a11y:** trap modal focus ([86bf877](https://github.com/DahliaWitt/braket-tickets/commit/86bf877fef9c6eebaa7f9dabf920aac076694901))
- **a11y:** use CDK harness for BRA-343 label association tests ([14fbefd](https://github.com/DahliaWitt/braket-tickets/commit/14fbefd1c755faef9f3d842dae16b73539011283))
- **a11y:** use text-foreground for vetting form labels to meet WCAG AA contrast ([c8eb57d](https://github.com/DahliaWitt/braket-tickets/commit/c8eb57de72b5a122dc761f2c7df69415182312c2))
- **access:** centralize event purchase decisions ([603c3c9](https://github.com/DahliaWitt/braket-tickets/commit/603c3c9029a8430d2240aeb13ff3585f0d883288))
- **account,vetting,events:** inline validation, rejection UX, admin directory ([51c6db5](https://github.com/DahliaWitt/braket-tickets/commit/51c6db5604104f46b85e6d80beb3c37af06b7471))
- **account:** add maxlength validation error message to display name field ([e36ffb4](https://github.com/DahliaWitt/braket-tickets/commit/e36ffb43318dfe5ab66504127c148ae045eb78f2))
- **account:** align card action buttons to bottom of cards ([45117eb](https://github.com/DahliaWitt/braket-tickets/commit/45117eb88d89c37e4c9cd0e3a73255d662430673))
- **account:** clarify email preferences unsubscribe banner when communities re-enabled ([6910111](https://github.com/DahliaWitt/braket-tickets/commit/6910111ec3b0d3fe038941ce6d2dd86784fb7867))
- **account:** gate same-email error display on field interaction ([f9e3f46](https://github.com/DahliaWitt/braket-tickets/commit/f9e3f469c661f5638119b84a83ddaed811028963))
- **account:** isolate password and email form validation state ([eb0ed75](https://github.com/DahliaWitt/braket-tickets/commit/eb0ed751dec4d37f0eb1093e0f1e22bd6193ced7))
- **account:** reject same-as-current email in change form ([aed2514](https://github.com/DahliaWitt/braket-tickets/commit/aed25140edb7de65385d0fe272a6beedcc165d4a))
- **account:** reject whitespace-only display names ([9e1135d](https://github.com/DahliaWitt/braket-tickets/commit/9e1135d3fd5f93b480fef5cae6003885e82a41c3))
- **account:** show inline validation before blur ([845e5c1](https://github.com/DahliaWitt/braket-tickets/commit/845e5c10b1ddbc30dff09712926ddde91472db36))
- **account:** show pending email change status with cancel option ([6a8fff2](https://github.com/DahliaWitt/braket-tickets/commit/6a8fff2b221ac8e3c5528013e2ccaacf32a85d98))
- **account:** show success toast on password change before logout ([6087c15](https://github.com/DahliaWitt/braket-tickets/commit/6087c15a438edfe459152760f857fb836086d282))
- **account:** surface rate limit error with retry timing on email change ([569e244](https://github.com/DahliaWitt/braket-tickets/commit/569e244b563de849ff2c9098903119112ade1d1d))
- **account:** wire account settings controls ([c237cd4](https://github.com/DahliaWitt/braket-tickets/commit/c237cd493868844400bf166152e99e7e8f6fce57))
- address audit follow-ups ([c2912e8](https://github.com/DahliaWitt/braket-tickets/commit/c2912e8afdeba26dd6c5bab56050476c3415a172))
- address review findings ([8b837bc](https://github.com/DahliaWitt/braket-tickets/commit/8b837bc9d77c6377dbc59c99af2c21061c239abf))
- **admin-audit:** scope guest.add audit log to organizer (BRA-344) ([9187316](https://github.com/DahliaWitt/braket-tickets/commit/9187316466801d2eeb6ec13d89fdd1e92d1b72c9))
- **admin:** add getTitleBlankErrorText harness method, use in spec ([36e1ad6](https://github.com/DahliaWitt/braket-tickets/commit/36e1ad64a1cf9f3d50bf995ea4ab94e6088ca5cc))
- **admin:** add guest creation toast ([bd293d7](https://github.com/DahliaWitt/braket-tickets/commit/bd293d78cccc3fef1a8456ae076aa37d7bdf673b))
- **admin:** align event email card padding ([0479d97](https://github.com/DahliaWitt/braket-tickets/commit/0479d97323b92c237bbd06628a9b76f6734dc2ca))
- **admin:** align tier pricing stats access ([f80ee46](https://github.com/DahliaWitt/braket-tickets/commit/f80ee46957ed175f75d43a61d1bf8b0519b517ad))
- **admin:** block protected event deletion in ui ([1afa924](https://github.com/DahliaWitt/braket-tickets/commit/1afa9241ca2884d06c74b4a445524a440c62b70d))
- **admin:** BRA-325 numeric min + BRA-405 maxlength on reminder/broadcast inputs (BRA-401 no-op — repro stale) ([cd4bd9e](https://github.com/DahliaWitt/braket-tickets/commit/cd4bd9e4d3cbd97b6bf6963625f1c66acdf67a64))
- **admin:** cover trust-link removal ([834c92d](https://github.com/DahliaWitt/braket-tickets/commit/834c92de2af1c127b83e7aa2e99d7b8ab988a8b5))
- **admin:** default notaflof max amount ([47b5a04](https://github.com/DahliaWitt/braket-tickets/commit/47b5a04679784878437bc53e525fe7a932bf319e))
- **admin:** exclude inactive applicants from members ([634fccf](https://github.com/DahliaWitt/braket-tickets/commit/634fccf97ce55fa780f644439e3a36c54f73bfd5))
- **admin:** exhaustive audit action labels + snapshot deleted event title (BRA-98 BRA-400) ([d551945](https://github.com/DahliaWitt/braket-tickets/commit/d551945784da171bd6fd0ab83647a147c3efeed6))
- **admin:** fix lint errors and remove stale min-attr test ([40d43dc](https://github.com/DahliaWitt/braket-tickets/commit/40d43dc4e4fbab6a933b4e7f0b20576d849ee5cd))
- **admin:** format check-in chart times in platform timezone ([c44e89f](https://github.com/DahliaWitt/braket-tickets/commit/c44e89fd62a3ee6c38f935936f11ee946504999c))
- **admin:** hide sales controls for draft events ([0931839](https://github.com/DahliaWitt/braket-tickets/commit/0931839ce597ba2548dfa2ca7e989580de6e0ebd))
- **admin:** keep active community selector value ([78a6c61](https://github.com/DahliaWitt/braket-tickets/commit/78a6c61ab0a7313d2e64392a623e7607a2ce2a33))
- **admin:** open management after event create ([5d596c4](https://github.com/DahliaWitt/braket-tickets/commit/5d596c41b1ff07e999ef12ad91b60f2358d1b99c))
- **admin:** polish audit log hover card ([aefa9d3](https://github.com/DahliaWitt/braket-tickets/commit/aefa9d35b0dec75b7dd046572b2f96e63dee39d8))
- **admin:** prevent dashboard tab vertical scrolling ([233a3bf](https://github.com/DahliaWitt/braket-tickets/commit/233a3bfa032c50c5c30f710beb9202c84428df4c))
- **admin:** prevent wheel edits in event pricing ([fb4a943](https://github.com/DahliaWitt/braket-tickets/commit/fb4a9438c0eeb9fe9e27539279b3aadf77e05abe))
- **admin:** remove dead /admin/reminders route ([0b12472](https://github.com/DahliaWitt/braket-tickets/commit/0b12472477f83c09884f2b44ec7eb1d658c73382))
- **admin:** remove min attributes conflicting with formField directive ([5791014](https://github.com/DahliaWitt/braket-tickets/commit/5791014bfc987d27170c09f7952e71d33b3b9cb6))
- **admin:** remove misleading member filter counts ([b29e6d6](https://github.com/DahliaWitt/braket-tickets/commit/b29e6d66d0dd30a44ab23e941bd88461d63bae6b))
- **admin:** repair attendee roster search ([e914437](https://github.com/DahliaWitt/braket-tickets/commit/e914437a183cc57fb917d99cb42372a883b36de0))
- **admin:** repair publish dialog announcement radios ([644cc6d](https://github.com/DahliaWitt/braket-tickets/commit/644cc6d20425f4269f16ec603e408bef55cacc06))
- **admin:** replace mobile admin tab rail ([5d109c9](https://github.com/DahliaWitt/braket-tickets/commit/5d109c9340054ab3e1f42bdeafbdaae7025b69aa))
- **admin:** resolve community admin spec lint ([2aedb1a](https://github.com/DahliaWitt/braket-tickets/commit/2aedb1a3eac79c79e51bb7ecfaeaa188d65391d1))
- **admin:** scope community events list ([08b16e0](https://github.com/DahliaWitt/braket-tickets/commit/08b16e01729b25316c0f0243082004a275ecdeb6))
- **admin:** stabilize community admin deep links ([c5087b6](https://github.com/DahliaWitt/braket-tickets/commit/c5087b6792d22a5ba8cd01837db697ec0671089b))
- **admin:** support slug-scoped community routes ([9a4045f](https://github.com/DahliaWitt/braket-tickets/commit/9a4045fe062880c8745da7ad359d2cfa03bc6fd6))
- **admin:** surface event create save feedback ([0590252](https://github.com/DahliaWitt/braket-tickets/commit/0590252e1eee0714c3ac7be4f476ebbb58de3683))
- **admin:** surface tier pricing stats errors ([384991b](https://github.com/DahliaWitt/braket-tickets/commit/384991b61d4648278e40c618501e24c37251ee39))
- **admin:** sync audit log detail accessibility state ([6fc36d6](https://github.com/DahliaWitt/braket-tickets/commit/6fc36d6043a9825215f38dcdee84b741c2536cc5))
- **admin:** sync community admin URL with selected community ([042efb7](https://github.com/DahliaWitt/braket-tickets/commit/042efb7b67a254286e8e0426019503b4c1a78a8f))
- **admin:** synchronize audit log detail disclosure ([f6d2d84](https://github.com/DahliaWitt/braket-tickets/commit/f6d2d8450625d65afce89000d184a9f509eac46b))
- **admin:** unify ?community= param + v.id format guard on event routes (BRA-387 BRA-407) ([dbf8fed](https://github.com/DahliaWitt/braket-tickets/commit/dbf8fed133a5ce03f6735d4ae7705010a091bf8b))
- **admin:** validate community slugs ([6b3cac9](https://github.com/DahliaWitt/braket-tickets/commit/6b3cac9930d0d8275e73cd5f1ec45ce6a107039a))
- **admin:** wire community event row actions ([c09f9e3](https://github.com/DahliaWitt/braket-tickets/commit/c09f9e38b4410162b116db5c94d3af1c71e11060))
- **admin:** wire magic link lifecycle actions ([52477f0](https://github.com/DahliaWitt/braket-tickets/commit/52477f0911733371aa73a46f32366bd804aa4ac4))
- **analytics:** add pageStatus to attendee roster return validator ([774b120](https://github.com/DahliaWitt/braket-tickets/commit/774b1206d54384000f469abc3fca33dbd4a02d49))
- another fix shit ([a33300a](https://github.com/DahliaWitt/braket-tickets/commit/a33300a9427b21dc7ca939909f33c4c697f8fd06))
- **applications:** use latest organizer application ([bca301a](https://github.com/DahliaWitt/braket-tickets/commit/bca301a3d2b94f0cc917b819ce5cfe99c8dba73b))
- audit log ([08c926b](https://github.com/DahliaWitt/braket-tickets/commit/08c926b9713f6a5f49db5e3548cfe18e15941e43))
- **audit-log:** record magic link admin actions ([e3c1ad3](https://github.com/DahliaWitt/braket-tickets/commit/e3c1ad362b6dbccb7a589bbcc7ed87898b46ce64))
- **audit:** add audit log entry for guest additions ([e37f5fb](https://github.com/DahliaWitt/braket-tickets/commit/e37f5fbdbd81529eb311f7ca793219ae13439cd0))
- **auth:** add invite signup handoff coverage ([a04a2d4](https://github.com/DahliaWitt/braket-tickets/commit/a04a2d4b36a986e93a9b5f74ee014416f236ca39))
- **auth:** allow email change retry flow ([f74d9e3](https://github.com/DahliaWitt/braket-tickets/commit/f74d9e34f8c840e1c3a739f656f1727d94691f7d))
- **auth:** cancel login cleanup timer on destroy ([71a75e7](https://github.com/DahliaWitt/braket-tickets/commit/71a75e7f1d82a18d605ab285716715ccfff368d9))
- **auth:** clarify email-change error copy for unrecognized links ([9383128](https://github.com/DahliaWitt/braket-tickets/commit/9383128352db27c8f1c4ed8f904dfcb197e03aa0))
- **auth:** handle invalid password reset links ([bc1b661](https://github.com/DahliaWitt/braket-tickets/commit/bc1b66175224d600aafdd2fa39f4fc2c5c57ac7a))
- **auth:** harden cross-tab login refresh ([a10bf16](https://github.com/DahliaWitt/braket-tickets/commit/a10bf16f4bbb11ac01c677669e5f964cf131e78c))
- **auth:** harden missing-user repair scheduling ([1b9805f](https://github.com/DahliaWitt/braket-tickets/commit/1b9805f90c349822372be0ae1a765c99b90d5e7c))
- **auth:** harden registration submit flow ([aebb8a4](https://github.com/DahliaWitt/braket-tickets/commit/aebb8a412a69c0c9d1cd01afdec90f6f98566775))
- **auth:** normalize password field placeholders ([b962af4](https://github.com/DahliaWitt/braket-tickets/commit/b962af4e7cb281590924da60c423a3f8cbfd100b))
- **auth:** repair email change confirmation flow ([ef4eaae](https://github.com/DahliaWitt/braket-tickets/commit/ef4eaaeed5657d8e740ddc72ffd9ce0bdd12830b))
- **auth:** restore signup return flow ([ad5a115](https://github.com/DahliaWitt/braket-tickets/commit/ad5a1159f4aaa29c1230b6f90c1a41dfe50f3f76))
- **auth:** reuse resolved user documents ([84b6d9a](https://github.com/DahliaWitt/braket-tickets/commit/84b6d9a36b35134bc45c45b184f13f9f25c02a92))
- **auth:** show reset email validation feedback ([eb80c22](https://github.com/DahliaWitt/braket-tickets/commit/eb80c2242816cf54044a0ebaba9c7448615a42e3))
- **auth:** validate password reset email ([dacf685](https://github.com/DahliaWitt/braket-tickets/commit/dacf6853d012a3a4beb881d0045052ac0dc145cb))
- **auth:** wait for verified user before redirect ([83219a1](https://github.com/DahliaWitt/braket-tickets/commit/83219a16f529a045f540a824b1c10794b794b656))
- **backend:** consolidate payment and vetting rules ([ebbad0a](https://github.com/DahliaWitt/braket-tickets/commit/ebbad0a8f68d1fa02d25efe57f7e302716d1b73c))
- **backend:** harden vetting and refund inference ([dfa2da8](https://github.com/DahliaWitt/braket-tickets/commit/dfa2da8155889769d820d50e0dddea9b19ba9f35))
- **build:** use Angular AOT compiler for frontend typechecking ([18ad2e5](https://github.com/DahliaWitt/braket-tickets/commit/18ad2e5a8eaf1a6616952ba88cf89c0095db10c7))
- bullshti ([d7722a7](https://github.com/DahliaWitt/braket-tickets/commit/d7722a72520e6196b7f0cd987003afec109a8309))
- **calendar:** align date picker accents with primary ([14bc71c](https://github.com/DahliaWitt/braket-tickets/commit/14bc71c177c8c77b3c0662d29571b70248e9127e))
- **check-in:** address self-review follow-ups on scan-permission commit ([4626317](https://github.com/DahliaWitt/braket-tickets/commit/46263177d82dd2d045281cb381f253c567427cb2))
- **check-in:** gate scan writes on scan permission, not roster read ([1aecafc](https://github.com/DahliaWitt/braket-tickets/commit/1aecafc8b35327a60028c1e866c150ee222c8a24))
- **checkout:** align supporter tier label with min price ([862d90e](https://github.com/DahliaWitt/braket-tickets/commit/862d90ea0053275f9c23eeb6b4d39ec6d2ac2343))
- **checkout:** ensure Stripe expires_at &gt;= 30min and surface fetchClientSecret errors ([4cb77ec](https://github.com/DahliaWitt/braket-tickets/commit/4cb77ecec3fb885cb7a2776086005cfa29d711ed))
- **checkout:** resolve four QA patrol bugs in checkout V2 flow ([0fb31e3](https://github.com/DahliaWitt/braket-tickets/commit/0fb31e32a994df83a741b9d667316727fc507d04))
- **checkout:** sync dialog state with URL query params on back navigation ([4076bd6](https://github.com/DahliaWitt/braket-tickets/commit/4076bd6b5e934a6c170fb731c5f704b613750d90))
- **checkout:** trap focus in checkout sidebar ([709295a](https://github.com/DahliaWitt/braket-tickets/commit/709295a5b633a5cd0b439a1ee7431fa29fcbe0ce))
- **ci:** forward --coverage flag through pnpm to vitest ([c3cd63e](https://github.com/DahliaWitt/braket-tickets/commit/c3cd63ea34e89c5ed0e64d811b0eb0ee276b64a6))
- **ci:** pass stripe v2 webhook secret to sandbox contracts ([3709e9e](https://github.com/DahliaWitt/braket-tickets/commit/3709e9e9c613f7c10c90ea5959db4f821ab397c6))
- **ci:** refresh preview deploy workflow paths ([bbde78a](https://github.com/DahliaWitt/braket-tickets/commit/bbde78ab41050714bfe4e20231ae7140af45ae6b))
- **ci:** refresh preview deploy workflow paths ([6ac4b82](https://github.com/DahliaWitt/braket-tickets/commit/6ac4b823106ad9e54184ed8f13fc33d676e7fe24))
- **communities:** add frontend maxlength validation to name and description fields ([fcd36f6](https://github.com/DahliaWitt/braket-tickets/commit/fcd36f63d433c41f165d90f32d91b834988b44be))
- **communities:** explain shared vetting source ([26bfb7e](https://github.com/DahliaWitt/braket-tickets/commit/26bfb7e9d9f590a468494e4f85155d99b6d30653))
- **communities:** refetch directory retries ([95edc7d](https://github.com/DahliaWitt/braket-tickets/commit/95edc7d38f12397214cc38a1ecfbc0375fb9b323))
- **communities:** show directory load errors ([7d9a17f](https://github.com/DahliaWitt/braket-tickets/commit/7d9a17f2545ecdffee2f2bfda04a71f312997ea5))
- **communities:** stabilize directory cards for missing data ([65bf81f](https://github.com/DahliaWitt/braket-tickets/commit/65bf81f9a198b3087671a658908099ef9b896317))
- **communities:** unify publication-status rule across access paths ([f756a46](https://github.com/DahliaWitt/braket-tickets/commit/f756a4647413714be69f4314077bba86a1d93e81))
- **convex:** add return validators and spec typing ([941197a](https://github.com/DahliaWitt/braket-tickets/commit/941197a50377d5fdb20803cf326e1f473e3a705d))
- **convex:** allow seedEvent default visibility ([1ab0484](https://github.com/DahliaWitt/braket-tickets/commit/1ab04849a93346ef1788620cd9acfc2478dd9a58))
- **convex:** fail closed invalid audit categories ([1d4ac8e](https://github.com/DahliaWitt/braket-tickets/commit/1d4ac8e79e1f75bdc4b5d0d0d4769864814c6350))
- **convex:** make check-in and reminder mutations idempotent ([50afa0c](https://github.com/DahliaWitt/braket-tickets/commit/50afa0cad3f6f6c8c177b386a51f2f6d20955a16))
- **convex:** narrow schema after prod migration, re-enable validation ([59a6828](https://github.com/DahliaWitt/braket-tickets/commit/59a68286828be771dfb2685f2d40046899b804bb))
- **convex:** preserve prod migration test fallbacks ([a538463](https://github.com/DahliaWitt/braket-tickets/commit/a5384639e31eb7dd08a310c37e2f92c84f47d240))
- **convex:** remove silent truncation in list queries ([a7dbf2e](https://github.com/DahliaWitt/braket-tickets/commit/a7dbf2e4772a77c63eba4d9331005d044cee8430))
- **convex:** resolve payout and admin edge cases ([7a9a57e](https://github.com/DahliaWitt/braket-tickets/commit/7a9a57e856dbc3d6f6b9209521e719f849864427))
- **convex:** standardize app error throws ([3b99cdf](https://github.com/DahliaWitt/braket-tickets/commit/3b99cdf58dbecea1bd79235e9bd2c8338c28cbfa))
- **csp:** allow connect-js.stripe.com for Stripe Connect embedded components ([2506690](https://github.com/DahliaWitt/braket-tickets/commit/25066901e9ec252477282e0f5ca01cd353cd5ee1))
- **csp:** allow connect-js.stripe.com for Stripe Connect embedded components ([301812e](https://github.com/DahliaWitt/braket-tickets/commit/301812eedac56705083da98c2b207a2bfa5f8ed8))
- **csp:** allow youtube-nocookie.com iframe on developer help page ([1596f89](https://github.com/DahliaWitt/braket-tickets/commit/1596f891b558b9c7bd4144b4f191205a16621f19))
- **dashboard:** use convexSiteUrl for public communities endpoint ([8638377](https://github.com/DahliaWitt/braket-tickets/commit/8638377ba4f38064875e36cc74bb599e90ead6a0))
- **dogfood:** resolve five issues surfaced by Stripe Connect V2 dogfood pass ([8d3203c](https://github.com/DahliaWitt/braket-tickets/commit/8d3203cab2a3ad87d7e871da7328a3e78196e705))
- **e2e:** clean up static frontend server ([a8c1c52](https://github.com/DahliaWitt/braket-tickets/commit/a8c1c52e1490c7e9f731638377074009f58e8e9d))
- **e2e:** harden email and guest checkout flows ([4f15e2e](https://github.com/DahliaWitt/braket-tickets/commit/4f15e2ecc206ef25dd497e378562d47395d82885))
- **e2e:** stabilize invite redemption and test auth retries ([80d69d1](https://github.com/DahliaWitt/braket-tickets/commit/80d69d110628567b6ffd6dfa26649d583cbeb9ff))
- **e2e:** stabilize validation and accessibility checks ([cbd390a](https://github.com/DahliaWitt/braket-tickets/commit/cbd390ab055225304211956c1afb3312540784e6))
- **e2e:** stabilize validation flows ([82242df](https://github.com/DahliaWitt/braket-tickets/commit/82242df5bda0498ee7f1b12756816966adaa3359))
- **e2e:** suppress noisy HTTP request logs from static file server ([2feb7d0](https://github.com/DahliaWitt/braket-tickets/commit/2feb7d01623f35572686ab48d86037579ef77862))
- **e2e:** wait for check-in event selection ([e91e00f](https://github.com/DahliaWitt/braket-tickets/commit/e91e00f09b597dd35bdc12b64e795dc4ea11b835))
- **email:** add unsubscribe support for event broadcasts ([b9d9201](https://github.com/DahliaWitt/braket-tickets/commit/b9d92013da077d3f8b1654a5f3910c941b891ba8))
- **email:** add unsubscribe to vetting reminders ([d787552](https://github.com/DahliaWitt/braket-tickets/commit/d7875521c6b8a4ddb6116ad526197e5b4f79d924))
- **email:** encode vetting reminder preheader dash ([ea44164](https://github.com/DahliaWitt/braket-tickets/commit/ea4416435e7d9da3105d746cadb72fe243f85d9d))
- **email:** use Convex site URL for all email api links ([ef2f005](https://github.com/DahliaWitt/braket-tickets/commit/ef2f005bc275344bce458803577eb8e56f97d8f5))
- **event-editor:** add min attribute on price and totalTickets inputs ([8722912](https://github.com/DahliaWitt/braket-tickets/commit/8722912103e5001746f760fcd82554e1d4d9ab53))
- **event-editor:** remove min attributes that conflict with formField directive ([c78a0b3](https://github.com/DahliaWitt/braket-tickets/commit/c78a0b31fb7f27babfb0bd9cb94b44e5e608397b))
- **event-editor:** use resource-driven loading safely ([33baffe](https://github.com/DahliaWitt/braket-tickets/commit/33baffefa70eb1b8fa8cc4ca7dc231735cdbf711))
- **events:** add contextual explanation for paused ticket sales ([df8a12c](https://github.com/DahliaWitt/braket-tickets/commit/df8a12cd6a2f5e87ed489f7856f92e03ebc1bb4e))
- **events:** add maxlength validation to event title field ([d051393](https://github.com/DahliaWitt/braket-tickets/commit/d051393b38944fa4839b4b2d099fe8d14447bc9e))
- **events:** correct LA upcoming date boundaries ([2ba1a68](https://github.com/DahliaWitt/braket-tickets/commit/2ba1a68cef968793c2a2362c8fe0c5a5ab18aacf))
- **events:** correct LA upcoming date boundaries ([64dda8c](https://github.com/DahliaWitt/braket-tickets/commit/64dda8c8e8acf56868ce8a9c575720545ca9682d))
- **events:** enforce visibility trust rules ([7c62368](https://github.com/DahliaWitt/braket-tickets/commit/7c623685009ea0bda3514c1b2edb8878478c63f2))
- **events:** gate batch availability by visibility ([e1804ca](https://github.com/DahliaWitt/braket-tickets/commit/e1804ca0388246c25731db14efb073b16cd09562))
- **events:** guard organizer reassignment ([ea7fd19](https://github.com/DahliaWitt/braket-tickets/commit/ea7fd191ef8fdc8f14b1c8adce2d8cd4a80fc651))
- **events:** hide past community events ([6154705](https://github.com/DahliaWitt/braket-tickets/commit/615470579ab584231267d56c28d3b589ee461e7d))
- **events:** reject whitespace-only event titles with validation error ([9c70127](https://github.com/DahliaWitt/braket-tickets/commit/9c701273e60ea07da1f72ff099d4750d2905e476))
- **events:** restore root admin community picker visibility (BRA-314) ([2af3350](https://github.com/DahliaWitt/braket-tickets/commit/2af335008772cd2b865f58b5485daedde23c1632))
- **feedback:** show toast after submit ([de63c48](https://github.com/DahliaWitt/braket-tickets/commit/de63c48580aa325ef69fe660b2d89c1a98874fce))
- fix shit ([e0e2b78](https://github.com/DahliaWitt/braket-tickets/commit/e0e2b78d53bfaff1c28f9535808a711e8a57abfd))
- fix shit ([90d83a1](https://github.com/DahliaWitt/braket-tickets/commit/90d83a12b17a5c998dc55bd44dab78452f6847a9))
- fixshit ([3ed7493](https://github.com/DahliaWitt/braket-tickets/commit/3ed74937eefbd2c47094223276ea582948367b45))
- **footer:** make feedback dialog interactive ([35ef4ed](https://github.com/DahliaWitt/braket-tickets/commit/35ef4ed84976504d3c429d496ddb539ee2ffe565))
- **frontend,backend:** close BRA-297 BRA-390 BRA-398 BRA-399 BRA-406 vetting gaps ([b8eedff](https://github.com/DahliaWitt/braket-tickets/commit/b8eedff840c6197e033a6059329c1d010bd7113b))
- **frontend:** add event editor validation guards (BRA-325) ([24d5834](https://github.com/DahliaWitt/braket-tickets/commit/24d58345bdcf9a2e642bd18a207d5038e49ef53b))
- **frontend:** address BRA-389 BRA-404 BRA-402 from QA patrol ([5aaaa07](https://github.com/DahliaWitt/braket-tickets/commit/5aaaa07450eda60623d2768c76122831e37c5e4e))
- **frontend:** address code-review findings F1 F2 F4 F6 F7 F8 ([407feff](https://github.com/DahliaWitt/braket-tickets/commit/407feff2b32be3d349e350e56b817d10f1f10bd6))
- **frontend:** clean up angular audit findings ([23f1a32](https://github.com/DahliaWitt/braket-tickets/commit/23f1a32c9b073c522f1fe8df08f2dfd4cbd9dab4))
- **frontend:** fail closed on vetting precheck errors ([9b32fd1](https://github.com/DahliaWitt/braket-tickets/commit/9b32fd1f4eecc3e89fe0c3bdab4e57a2464c3256))
- **frontend:** gate vetting and directory relationship states ([0d652a7](https://github.com/DahliaWitt/braket-tickets/commit/0d652a73dbe2d7fb0cb9abbdd378d14756ed83ff))
- **frontend:** gate vetting and directory relationship states ([091b2c7](https://github.com/DahliaWitt/braket-tickets/commit/091b2c783138456ca6afe3a9cd90606dbcd7f5a4))
- **frontend:** handle email change step-1 callback ([029d77b](https://github.com/DahliaWitt/braket-tickets/commit/029d77b7f16ba8f5b054e0ce0348a7756cbe38f4))
- **frontend:** harden browser platform boundary ([27a52cd](https://github.com/DahliaWitt/braket-tickets/commit/27a52cd69509aa5a5d08f8e40598ea81553d39f5))
- **frontend:** keep toast wrapper in app shell ([e1a4be8](https://github.com/DahliaWitt/braket-tickets/commit/e1a4be83f6b08688a80a9b5dd8181e56e6dcfb70))
- **frontend:** normalize Braket Tickets copy ([d4512d5](https://github.com/DahliaWitt/braket-tickets/commit/d4512d53dd358b7c91f5bc966377f3dd9644685d))
- **frontend:** polish dropdown select styling ([e932db4](https://github.com/DahliaWitt/braket-tickets/commit/e932db4f4872711e57f3e2a1659c0b5c41a13b2f))
- **frontend:** prerender public compliance routes ([e065dfc](https://github.com/DahliaWitt/braket-tickets/commit/e065dfcf3e964f2c86b2997c5b3e9d1ab1bb2355))
- **frontend:** recompute platform organizer publish readiness ([c1a2c05](https://github.com/DahliaWitt/braket-tickets/commit/c1a2c057fe35b373bad6a08571679b692aa31bf8))
- **frontend:** recompute platform organizer publish readiness ([02d23d5](https://github.com/DahliaWitt/braket-tickets/commit/02d23d51972676fcdcaf180ffdc22054c40d7322))
- **frontend:** reject whitespace-only names in signup and community create forms (BRA-378, BRA-408) ([c543817](https://github.com/DahliaWitt/braket-tickets/commit/c5438171e8c21805040a8a437615d45ea3500ca3))
- **frontend:** remove mermaid from docs bundle ([614a426](https://github.com/DahliaWitt/braket-tickets/commit/614a426eeeb37f95159588c01c12891c5d8f53e9))
- **frontend:** render icons during prerender ([8049f81](https://github.com/DahliaWitt/braket-tickets/commit/8049f813438cb84c6fb6fe5aa1c411f5613052fe))
- **frontend:** resolve dogfood UI feedback ([d1fa98f](https://github.com/DahliaWitt/braket-tickets/commit/d1fa98f289fd248f5bee4ea5c681aa67b7b0a263))
- **frontend:** restore landing hero copy ([20ff046](https://github.com/DahliaWitt/braket-tickets/commit/20ff046238bc94fb48f5751362de7c38923efb83))
- **frontend:** route event card info links ([1d8b018](https://github.com/DahliaWitt/braket-tickets/commit/1d8b0180ee576ce4e7f4ab88a2548e4ff326424b))
- **frontend:** satisfy event details lint limit ([30b930d](https://github.com/DahliaWitt/braket-tickets/commit/30b930d3f2942f7871b1fc83ff2e8873b2128e8c))
- **frontend:** satisfy vetting spec lint ([743eee2](https://github.com/DahliaWitt/braket-tickets/commit/743eee25b0d460184fdb4e5ec3e14dfa3854df41))
- **frontend:** show active feedback reason chips ([0704ca0](https://github.com/DahliaWitt/braket-tickets/commit/0704ca073e6e397b2fe91faeaeb5ee7d743037fe))
- **frontend:** show contact mail options dialog ([cc169d5](https://github.com/DahliaWitt/braket-tickets/commit/cc169d5d9ad0dbfbf192a88bf4ea871bf6ffb9b0))
- **frontend:** type server auth stubs ([3c4d6c6](https://github.com/DahliaWitt/braket-tickets/commit/3c4d6c6a44381e615eb5c04921f88ab78460afac))
- **frontend:** use isRecord in extractErrorMessage rejection branch ([8536df4](https://github.com/DahliaWitt/braket-tickets/commit/8536df425845c061e6d9d9b3caf5c0c5e1a55d47))
- **guest-checkout:** add email resume flow for active sessions ([cadd73b](https://github.com/DahliaWitt/braket-tickets/commit/cadd73b547e9e1c48b498e4afa7817700d5342b7))
- **header:** lock background scroll when mobile menu is open (BRA-380) ([450108f](https://github.com/DahliaWitt/braket-tickets/commit/450108f9fa6934325b11723b826c1489b25286f1))
- **help:** render developer docs diagrams ([8220889](https://github.com/DahliaWitt/braket-tickets/commit/822088983e9eb30880df8e406526cf4aac040c42))
- **invite:** cancel stale delayed redirect ([0df7636](https://github.com/DahliaWitt/braket-tickets/commit/0df7636c00e0777cc33aac1d899959d43bb45076))
- **invites:** sanitize admin invite redemption errors ([304045e](https://github.com/DahliaWitt/braket-tickets/commit/304045eb40734e8b798e2546f1f16ef554e5b15e))
- **lint:** register no-raw-db-mutations in backend config for testing_functions.ts ([072d8ca](https://github.com/DahliaWitt/braket-tickets/commit/072d8ca2ed27806fdc497bbbd1924fd40042b152))
- **magic-links:** add label maxlength validation and table truncation ([3da48ce](https://github.com/DahliaWitt/braket-tickets/commit/3da48ceba684b2db24f2eed52e558b05328b9506))
- **magic-links:** fix code review findings from PR [#653](https://github.com/DahliaWitt/braket-tickets/issues/653) ([9f1ac1d](https://github.com/DahliaWitt/braket-tickets/commit/9f1ac1dd1c63d971b8fbc95d0f68031a451aed4b))
- **magic-links:** handle unlimited redemptions and reject zero value ([2fcb5af](https://github.com/DahliaWitt/braket-tickets/commit/2fcb5afb072a1b1d182f8af180124e01c07acbae))
- **magic-links:** show correct toast when existing member opens magic link ([ffbe457](https://github.com/DahliaWitt/braket-tickets/commit/ffbe457d917828a22e2e133e95445251fb9eff8c))
- **magic-links:** use strict undefined check for maxRedemptions display ([7650bea](https://github.com/DahliaWitt/braket-tickets/commit/7650beab3bb4315aec0cf125120566729c3fb0ce))
- **marketing:** use Convex site URL for email api links ([da4bdad](https://github.com/DahliaWitt/braket-tickets/commit/da4bdadc82b95a840983dd5a2c1bbb2ef798530c))
- **orders:** skip expiry reschedule for final orders ([ae6eeb1](https://github.com/DahliaWitt/braket-tickets/commit/ae6eeb1914c748ca92466e7b7f98413e1238f64e))
- **payments:** enable seeded paid checkout ([343f388](https://github.com/DahliaWitt/braket-tickets/commit/343f388e124f976ac793857a881e748c2176bac2))
- **payments:** harden order financial reporting ([825440a](https://github.com/DahliaWitt/braket-tickets/commit/825440ad734bf4b2873ffdf345ae6acad5ade20a))
- **payments:** make mock refund ids idempotency-based ([5decda0](https://github.com/DahliaWitt/braket-tickets/commit/5decda0fc3529c6e42b1266edf046d1b48f128f5))
- **payments:** use official Stripe.js loader ([c2fd8a2](https://github.com/DahliaWitt/braket-tickets/commit/c2fd8a2dc672e7d7457a108c1084510b58323f26))
- **reminders:** apply opt-out filter to ticket-purchase reminders ([9d786a6](https://github.com/DahliaWitt/braket-tickets/commit/9d786a6312a9f983af7516c78da8b151ac8970e6))
- resolve remaining review findings ([5f76320](https://github.com/DahliaWitt/braket-tickets/commit/5f7632002ff80f348ae0431f3e79e313f3901d0d))
- **routing:** redirect /admin/reminders to /admin instead of 404 (BRA-353) ([ed92c9f](https://github.com/DahliaWitt/braket-tickets/commit/ed92c9fd20d57727a7fb9fa6905b5e11f162e3c8))
- **scanner:** allow attendee list scrolling ([e995088](https://github.com/DahliaWitt/braket-tickets/commit/e9950889cfebe977b6c635f24c0a7cf456a65d63))
- **scanner:** allow retry after failed scan ([fd190a0](https://github.com/DahliaWitt/braket-tickets/commit/fd190a02c31c042ad65294fe1649185e1e63f722))
- **scanner:** allow retry after failed scan ([03a5cf9](https://github.com/DahliaWitt/braket-tickets/commit/03a5cf93549670760c4a3f14ca76cd036bffd628))
- **scanner:** unlock scanning after event selection ([c90a539](https://github.com/DahliaWitt/braket-tickets/commit/c90a539228bf51f7bdabf4071c25d530dfd6a90b))
- **security:** address code review findings on email enumeration fix ([8137dff](https://github.com/DahliaWitt/braket-tickets/commit/8137dff28a9a7737e6259f94f8edd0acbc05e6a8))
- **security:** harden production env sync ([00239c3](https://github.com/DahliaWitt/braket-tickets/commit/00239c33b2a06d1cfcae93c5afaf8577fa53156e))
- **security:** prevent email enumeration on registration ([f99333d](https://github.com/DahliaWitt/braket-tickets/commit/f99333de45b0932bf0d5ecb1c290fc3ce62bab64))
- **seed:** add Midnight Sound to public community directory ([c08db13](https://github.com/DahliaWitt/braket-tickets/commit/c08db133edd0e9616d761336fdc25d90fdf41597))
- **seed:** correct Low Frequency initial soldCount to prevent inventory overrun ([a7bed5b](https://github.com/DahliaWitt/braket-tickets/commit/a7bed5baed59edcd591dd1a0eb473ac39b2c48d8))
- **seed:** normalize short dates to noon UTC to preserve calendar day across timezones ([f1099a3](https://github.com/DahliaWitt/braket-tickets/commit/f1099a38127c5f28cc6ab35baac7f84ebd7fe8b6))
- show directory load errors ([55dd329](https://github.com/DahliaWitt/braket-tickets/commit/55dd3290ef54787ccb05110deaba127743aff9e0))
- **skeleton:** address code review findings ([55cacbe](https://github.com/DahliaWitt/braket-tickets/commit/55cacbe5f41691e42f84015a42f116b8341c51d1))
- **stripe-connect:** centralize connect appearance tokens and review guardrails ([c05477c](https://github.com/DahliaWitt/braket-tickets/commit/c05477c8455f47a3c47337805e7e2ab120c9c25e))
- **stripe:** apply review findings on webhook idempotency refactor ([e0a6056](https://github.com/DahliaWitt/braket-tickets/commit/e0a60567b0aa3c996e0ebbb0fd5fa4bdc2c8763f))
- **stripe:** close code-review findings — critical, important, and nit ([9a1ecbe](https://github.com/DahliaWitt/braket-tickets/commit/9a1ecbe510512214b9d0f1a0ba89ef1ab000fc78))
- **stripe:** correct order-id validation and release claims for retry ([f007e2b](https://github.com/DahliaWitt/braket-tickets/commit/f007e2bb43f025d544de8b0849cd61176020a8ee))
- **stripe:** harden checkout settlement ledger ([614e873](https://github.com/DahliaWitt/braket-tickets/commit/614e8736d94b1f32c34fac911e31c4fd2053a365))
- **stripe:** remove SDK alias shim ([0c5e8de](https://github.com/DahliaWitt/braket-tickets/commit/0c5e8de2c882e6085511432ec031ba02df5ad870))
- **stripe:** repair V2 embedded Connect mounting and add hosted-onboarding fallback ([1593e4e](https://github.com/DahliaWitt/braket-tickets/commit/1593e4ecc137ba1279431d62df6eb5677af1e196))
- **stripe:** resolve four QA patrol bugs in Stripe Connect V2 onboarding ([43ffb96](https://github.com/DahliaWitt/braket-tickets/commit/43ffb9623fd1f6eba931e6619d5579161a21e268))
- **stripe:** second-round review — mutation ordering, error propagation, test hygiene ([bf62c54](https://github.com/DahliaWitt/braket-tickets/commit/bf62c547dccfd13be0405100a65f19f538d19f42))
- **stripe:** sync connect webhook env names ([337d1be](https://github.com/DahliaWitt/braket-tickets/commit/337d1be42dc91ba2f6abf51c4f25d69cd1273673))
- **stripe:** tighten v2 related_object typing ([35b6035](https://github.com/DahliaWitt/braket-tickets/commit/35b603544c4236c73eb5f34db640c66d8eb6c6f6))
- **tabs:** preserve tab identity across dynamic updates ([e82d864](https://github.com/DahliaWitt/braket-tickets/commit/e82d864de2033fe9dd025c69078095b2384ca916))
- **test:** allow testing_functions in sandbox contract tests ([0eac30c](https://github.com/DahliaWitt/braket-tickets/commit/0eac30ca2f9650eff4046757c7fb45393f4a4189))
- **test:** resolve lint errors in skeleton screen specs ([2c04e09](https://github.com/DahliaWitt/braket-tickets/commit/2c04e09563846e3464bf81a59b1aee9502450d3c))
- **test:** silence unit warning noise ([4555fdd](https://github.com/DahliaWitt/braket-tickets/commit/4555fdd23423894b5ed12c97df4ba81278caf17f))
- **tickets:** add missing fields to generateTicketPdf return validator ([64ad6f7](https://github.com/DahliaWitt/braket-tickets/commit/64ad6f7bf8079287bf404fe7747229c6e1d9df9e))
- **tickets:** add resale listing confirmation flow ([12d9632](https://github.com/DahliaWitt/braket-tickets/commit/12d9632d60fc8b3c93a15a2522a40931cee68b25))
- **tickets:** clarify free ticket success copy ([879c9e9](https://github.com/DahliaWitt/braket-tickets/commit/879c9e987da17b9c79b5822d5f5888d4f82286eb))
- **tickets:** clear queued refresh state on logout ([250b6c4](https://github.com/DahliaWitt/braket-tickets/commit/250b6c4f2a5f7240124b26ffe4337a5dd92876ff))
- **tickets:** extract checkout sidebar template ([c3e8f2b](https://github.com/DahliaWitt/braket-tickets/commit/c3e8f2b19dd85c58e71691776e10392ae99f7a5c))
- **tickets:** hide resale banner when ticket sales are paused or ended ([c019705](https://github.com/DahliaWitt/braket-tickets/commit/c019705907c6599c77ff0aa93df05904a1abeb36))
- **tickets:** improve contact community email copy ([e671216](https://github.com/DahliaWitt/braket-tickets/commit/e671216495bfa0b584a685c9b72ef99f4b4a572d))
- **tickets:** improve sold-out notification layout ([5e8c18e](https://github.com/DahliaWitt/braket-tickets/commit/5e8c18ef3e4d5b50f7b08fdb278938bdea8b0973))
- **tickets:** preserve checkout login return url ([642be9e](https://github.com/DahliaWitt/braket-tickets/commit/642be9ec51497a046d5febd24732784ee184cc22))
- **tickets:** send NOTAFLOF checkout totals ([828056d](https://github.com/DahliaWitt/braket-tickets/commit/828056dc2d433e900376f9b41fade4eb3985c7ca))
- **tickets:** stabilize checkout focus and app status key ([6c64985](https://github.com/DahliaWitt/braket-tickets/commit/6c649852af56e0bd04a2231046269f4218892c5e))
- **ui:** datepicker height, sign-in button style, dashboard copy ([d3b4ce3](https://github.com/DahliaWitt/braket-tickets/commit/d3b4ce392df7cebb1ecdd569aff220b3c46fb937))
- **ui:** raise community status card contrast and document password placeholder stripping ([9af7cd6](https://github.com/DahliaWitt/braket-tickets/commit/9af7cd6d371531cd97a8d502732a1b8cd9ccd98c))
- **ui:** resolve shared control regression tickets ([3146e15](https://github.com/DahliaWitt/braket-tickets/commit/3146e15bf6880a5150a4d24582db768538ed51ed))
- **ui:** use outline variant for cancel buttons ([25dba5c](https://github.com/DahliaWitt/braket-tickets/commit/25dba5cfccf608327e8b733911be9c1ae7beaa3c))
- **ui:** use warning semantic token for marketing opt-out banners ([5de086f](https://github.com/DahliaWitt/braket-tickets/commit/5de086fefe5f1a67d5eaa7ac41c74b55df8bb587))
- **unsubscribe:** show error state when no token query param present ([c764e78](https://github.com/DahliaWitt/braket-tickets/commit/c764e78dce74cc304e0a18fae38d365ee19fc4dd))
- **validation:** restore validate and e2e gates ([b956deb](https://github.com/DahliaWitt/braket-tickets/commit/b956deb9f9b0757f6077301baa12e20883ea9457))
- **vetting:** deduplicate community cards on home page after re-submission ([a4561c2](https://github.com/DahliaWitt/braket-tickets/commit/a4561c2620d0609f5be8814afc87dd735bd26529))
- **vetting:** hide conduct agreement without policy ([4efce60](https://github.com/DahliaWitt/braket-tickets/commit/4efce604d396f80f0924fa38ceeddd661fdcf901))
- **vetting:** restore draft answers across navigation ([0c4ce78](https://github.com/DahliaWitt/braket-tickets/commit/0c4ce78ce3eb77ff53dc36b4553c0bc6a52fba4c))

### Performance

- **frontend:** use NgOptimizedImage for organizer logos on event details ([85ce661](https://github.com/DahliaWitt/braket-tickets/commit/85ce661ec9fce1c3af7436b2a8dd95052375c223))

### Code Refactoring

- **access:** derive EventWithVisibility from schema, remove defensive fallback ([3d15295](https://github.com/DahliaWitt/braket-tickets/commit/3d1529541c6d5d1399572d08c30946b6b83d1b42))
- **access:** remove current-user wrapper layer ([e76f63b](https://github.com/DahliaWitt/braket-tickets/commit/e76f63b86f0479dae56183f017c7e1b7a0545916))
- **access:** remove getEffectiveVisibility and EventWithVisibility ([3f6d8d2](https://github.com/DahliaWitt/braket-tickets/commit/3f6d8d20f211790ea54055ea197b7d0463faf356))
- **admin-audit:** derive adminAuditActionValidator from ADMIN_AUDIT_ACTIONS ([2cc49b3](https://github.com/DahliaWitt/braket-tickets/commit/2cc49b3bb4f91ce76c26cdaaad9d4e5c905737e3))
- **admin:** replace community badge ngClass bindings ([a82a0f7](https://github.com/DahliaWitt/braket-tickets/commit/a82a0f7587d383a49bb8f94c7c3e480516f534ce))
- **auth:** add canonical requireUser resolver ([63c4899](https://github.com/DahliaWitt/braket-tickets/commit/63c489920a46c50bb18e51781dcd650f7bcf7b36))
- **auth:** migrate actor callsites to requireUser ([b679044](https://github.com/DahliaWitt/braket-tickets/commit/b679044f4c53a583523b7306dc3e2aa232a9aff8))
- **auth:** remove legacy user-id helper surface ([641bb58](https://github.com/DahliaWitt/braket-tickets/commit/641bb5893d1a81298ca096229bb117f6cc790a88))
- **auth:** simplify requireUser id callsites ([5600bba](https://github.com/DahliaWitt/braket-tickets/commit/5600bba8c031f6ddbb1ebd6af02f817e36be93da))
- **authz:** route isCommunityMember check through access.ts ([d02c4c8](https://github.com/DahliaWitt/braket-tickets/commit/d02c4c8167d835a09e36716eab23dabd58ee057f))
- **backend/convex:** centralize batch fetching patterns and user row building ([a1ba2ee](https://github.com/DahliaWitt/braket-tickets/commit/a1ba2eeb1bc679a4c326cb65fd96cd18584a3ab3))
- **backend:** Remove unused community type aliases ([67456d5](https://github.com/DahliaWitt/braket-tickets/commit/67456d51a6651be7a956faa4a89a145a6d216811))
- consolidate inlined schema enums across backend + frontend ([3625afa](https://github.com/DahliaWitt/braket-tickets/commit/3625afa22019a5e88b39665e5fed400ef30dabcb))
- **convex:** address review findings on audience consolidation ([6e0177f](https://github.com/DahliaWitt/braket-tickets/commit/6e0177f42fbc081f07e322e05246ee6719e3cc15))
- **convex:** centralize backend domain logic ([41a3242](https://github.com/DahliaWitt/braket-tickets/commit/41a324299b94333820c09e3f71d3e453f5c98323))
- **convex:** centralize duplicated validators ([523b654](https://github.com/DahliaWitt/braket-tickets/commit/523b654f0215c9c138b197de893c855fa699c53f))
- **convex:** centralize validators and app errors ([e16d9fd](https://github.com/DahliaWitt/braket-tickets/commit/e16d9fdfb7a8ccdba00d9f13f68f85091120ab41))
- **convex:** consolidate event load-and-authorize preamble into access helpers ([31f5e46](https://github.com/DahliaWitt/braket-tickets/commit/31f5e464ae1ae6e6610f9643801b2e4bfb73f2aa))
- **convex:** consolidate seed-only order helpers ([d69f4c3](https://github.com/DahliaWitt/braket-tickets/commit/d69f4c3fb752b0568057ea3b768a081f6ee59aee))
- **convex:** consolidate SSOT across authz, resale FSM, auth helpers, and visibility ([c2ffca4](https://github.com/DahliaWitt/braket-tickets/commit/c2ffca4e5c472bb239325faefa41ccc9de75535a))
- **convex:** decompose testing_functions into domain modules ([25a21c0](https://github.com/DahliaWitt/braket-tickets/commit/25a21c0f3e1c9c7e8221c0e12c7273991ca6dbe1))
- **convex:** finish session SSOT cleanups — FSM, audit repair, auth-helper moves ([db00131](https://github.com/DahliaWitt/braket-tickets/commit/db00131fce925dc9a13285ff9417d80de7734239))
- **convex:** inline single-use read model helpers and use composite index ([e52ecfa](https://github.com/DahliaWitt/braket-tickets/commit/e52ecfa23a3d79e7710b1d9bf8e2f06f3f0cdd7c))
- **convex:** organize backend by feature ([f61823d](https://github.com/DahliaWitt/braket-tickets/commit/f61823dc87144a37ffd032501f032100bfb98d3e))
- **convex:** remove unused schema indexes ([e8e0d1e](https://github.com/DahliaWitt/braket-tickets/commit/e8e0d1e542545776e55bb12e43f999726ed13a3f))
- **convex:** revert rate-limit ordering — Convex rolls back counter on authz throw (BRA-384) ([4389c44](https://github.com/DahliaWitt/braket-tickets/commit/4389c444dd85390f2dcf085b8faae67db35727a2))
- **convex:** swap take() safety caps for bounded collect() ([ea8567a](https://github.com/DahliaWitt/braket-tickets/commit/ea8567aa3cf92a2350e6a3d2a903cd748fde8fae))
- **convex:** unify email dispatch and collapse auth+authz boilerplate ([5c2c4a4](https://github.com/DahliaWitt/braket-tickets/commit/5c2c4a4b56e520acbde47e372d4bffaa56ea9871))
- **errors:** add shared getAppErrorMessage helper ([7657092](https://github.com/DahliaWitt/braket-tickets/commit/76570925106717f46a9ab6c792eea7103148bca0))
- **event-details-stories:** derive StoryTrustResult from checkUserTrust return type ([e0c18ec](https://github.com/DahliaWitt/braket-tickets/commit/e0c18ec86626cc31d45c81bdeee3cfbe3eee1502))
- **events:** collapse event validation drift ([79ea3d9](https://github.com/DahliaWitt/braket-tickets/commit/79ea3d95c45f170f7240cf0aae9c4c28024abca1))
- **events:** harden timezone parsing and test seeding ([6675bbe](https://github.com/DahliaWitt/braket-tickets/commit/6675bbe2d5d6f244774ed76e2caf5d25723656db))
- **events:** require full ISO 8601 UTC for event.date ([13b13c6](https://github.com/DahliaWitt/braket-tickets/commit/13b13c6f6e861f2da40eb347e2441f87e8892b0b))
- **events:** split management surfaces and fix review findings ([6a011fd](https://github.com/DahliaWitt/braket-tickets/commit/6a011fde5d8a6ddebee78111ef9248d03d0b0847))
- **frontend:** extract shared toEventId helper ([28d0e5e](https://github.com/DahliaWitt/braket-tickets/commit/28d0e5ec2d0cbd7e1a0a6b8f3318deea8880568a))
- **frontend:** make check-in roster computed from query signals ([f3c65fb](https://github.com/DahliaWitt/braket-tickets/commit/f3c65fbcafc7c49abb3d5b4c697f82e12b10644d))
- **frontend:** remediate angular audit foundations ([b9b4f7d](https://github.com/DahliaWitt/braket-tickets/commit/b9b4f7d87782bd4601a1c2998c610a6bfeadc0e8))
- **frontend:** share auth-settled helper across guards, cache scanner access ([c81b5ee](https://github.com/DahliaWitt/braket-tickets/commit/c81b5eeb322ec510f4ca5eda15275824731eb3eb))
- **frontend:** split audit remediation seams ([0c9382f](https://github.com/DahliaWitt/braket-tickets/commit/0c9382f02ce147c7248a1dac4c6ec7af3678bda5))
- **inventory:** remove events.soldCount drift, make event_inventory sole source ([677cf98](https://github.com/DahliaWitt/braket-tickets/commit/677cf983cc571b69002ac6672498d98a6a3d001e))
- **inventory:** tighten held-lifecycle surface — drop dead pendingCount, add scheduler-fired expiry test ([8b1ab32](https://github.com/DahliaWitt/braket-tickets/commit/8b1ab320ef744046943c4e93b6deae452c55f406))
- **lint:** enforce no-raw-db-mutations on testing_functions.ts ([6997e42](https://github.com/DahliaWitt/braket-tickets/commit/6997e429c08faac4cb5f5ecb8a8b17bb7d76e61b))
- **orders:** split transitions god file by state area ([4f4baed](https://github.com/DahliaWitt/braket-tickets/commit/4f4baedf9a0fbd0f064d3566bd4772ce8f606d45))
- **resale:** address self-review findings on finalizeResaleState ([41634c4](https://github.com/DahliaWitt/braket-tickets/commit/41634c479956c353fabd0e4e70156b4302dfe57e))
- **resale:** split finalizeResaleState into phased helpers ([1ed9744](https://github.com/DahliaWitt/braket-tickets/commit/1ed97445e3a9751734717571bc4ca0f95753830e))
- **review:** address remaining review findings across backend and frontend ([3bf41f9](https://github.com/DahliaWitt/braket-tickets/commit/3bf41f9c56fb1086635d1ef9504e88fba363d770))
- **review:** fail requests on audit-log errors; deterministic recipient tiebreak ([739b87e](https://github.com/DahliaWitt/braket-tickets/commit/739b87e665b3165ed7ab62fc4ac219602a8fb1a2))
- **schema:** import canonical enum validators instead of inlining unions ([e79866e](https://github.com/DahliaWitt/braket-tickets/commit/e79866ee2f35c76b5ba13526f43e7a6139a7d895))
- **seed:** replace placeholder names and copy with fictional characters and shitpost text ([a622d00](https://github.com/DahliaWitt/braket-tickets/commit/a622d0051206eab36818fc4cfb7f02d7c9cab9f8))
- **shared-types:** extract domain unions to shared/domain canonical modules ([0f6ed1b](https://github.com/DahliaWitt/braket-tickets/commit/0f6ed1bb77ff817b4a39ab8d8fef76cf50bef1ea))
- **shared:** centralize payout delay constants ([f7225e5](https://github.com/DahliaWitt/braket-tickets/commit/f7225e5392dd0f64a2b0886f252de7c5399a3954))
- **shared:** consolidate duplicated isRecord, extractErrorMessage, and Convex reference matchers ([e8afca6](https://github.com/DahliaWitt/braket-tickets/commit/e8afca600ec07554b71f19d0147eb032383ac77a))
- **stripe:** centralize connect readiness ([b4fba42](https://github.com/DahliaWitt/braket-tickets/commit/b4fba422cd170c12cd85f98b9a65ec298f85f345))
- **stripe:** centralize constants, create V2 account config SSOT ([36d0720](https://github.com/DahliaWitt/braket-tickets/commit/36d0720ca2327a8925812ac731a4b5518763de15))
- **stripe:** centralize organizer preconditions ([8ef93db](https://github.com/DahliaWitt/braket-tickets/commit/8ef93dbb3441d4df0ad5b8a465ce00f457cb8838))
- **tests:** eliminate unsafe type casts and upgrade test dependencies ([3464f32](https://github.com/DahliaWitt/braket-tickets/commit/3464f322d84fde28e5fb90ba528db1315a8b2e99))
- **test:** wire testing_functions.ts helpers to internal mutations ([a653fc6](https://github.com/DahliaWitt/braket-tickets/commit/a653fc6a1544968b6ce47edefdee9090f3cd99d8))
- **ticketing:** consolidate order payment flows ([1bd6f80](https://github.com/DahliaWitt/braket-tickets/commit/1bd6f8005b0efb8147f694f861afd4118da62e1b))
- **unsubscribe:** load preferences with resource ([e829d9f](https://github.com/DahliaWitt/braket-tickets/commit/e829d9f5710ce8ed10bda634effe10fdc1fa8751))

### Documentation

- add Agent Lint context maintenance section ([872863f](https://github.com/DahliaWitt/braket-tickets/commit/872863fc9d98b9dfd582288b01f7f09874905974))
- add git safety and code quality rules to AGENTS.md ([f3169ea](https://github.com/DahliaWitt/braket-tickets/commit/f3169ea0b9f05e7dcb2f68d7c0fa7bfbd825d003))
- **agents:** flag testing_functions.ts as canonical seed migration target on schema/validator change ([3699173](https://github.com/DahliaWitt/braket-tickets/commit/36991735114f1385790608bba61582d553693c03))
- clean up open-source docs artifacts ([9126d73](https://github.com/DahliaWitt/braket-tickets/commit/9126d73a480f31a87ecaffadcd2803072e76626e))
- **frontend:** add audit manifest metadata ([66d7405](https://github.com/DahliaWitt/braket-tickets/commit/66d7405cfe3f691e4426960da895192f4cb4f0c7))
- **gemini:** refresh code review styleguide ([46ab845](https://github.com/DahliaWitt/braket-tickets/commit/46ab84560d0434828d93c72bd63dfd8c05876ad6))
- **plan:** mark auth helper consolidation verification complete ([ce9fb19](https://github.com/DahliaWitt/braket-tickets/commit/ce9fb1941b2ea5101f98231bfa00697ffab4371d))
- remove public scaffolding artifacts ([d70a45e](https://github.com/DahliaWitt/braket-tickets/commit/d70a45e4d5dc2daa64814117ca052ff009dc9d0f))
- **runbooks:** add manual deploy guidance ([061c3f7](https://github.com/DahliaWitt/braket-tickets/commit/061c3f79f416a1a2b75a6b281c0e6613c43f66ca))
- **runbooks:** document img-src data: requirement for Stripe 3DS ([aee4e6e](https://github.com/DahliaWitt/braket-tickets/commit/aee4e6edec45169404564820aaccc5dbec904206))
- **skills:** add code review workflow skill ([fb00f8e](https://github.com/DahliaWitt/braket-tickets/commit/fb00f8e71c33f9c56f5bb2ef375b6632d432a3b9))
- **skills:** add local git workflow helpers ([7ad6697](https://github.com/DahliaWitt/braket-tickets/commit/7ad669795f8bba79e6b064ebb0537289b2f15a8e))
- **stripe:** update embedded checkout ui_mode ([50871c8](https://github.com/DahliaWitt/braket-tickets/commit/50871c86afc7532f3fe75c41c6fb8b4831730292))
- unify docs under /docs and drop generated docs/api pipeline ([f86ce52](https://github.com/DahliaWitt/braket-tickets/commit/f86ce522fecd94c334d3a8bc6d056fe04ad30e76))

### Tests

- **admin:** cover magic links empty-state create CTA ([763f891](https://github.com/DahliaWitt/braket-tickets/commit/763f8917befe43a48692fb8db62dcf3547da765a))
- **admin:** cover magic-link lifecycle feedback ([0d3a489](https://github.com/DahliaWitt/braket-tickets/commit/0d3a4897f9ab420c62649ebf9a949b7c879587c1))
- **admin:** cover membership removal controls ([8415fce](https://github.com/DahliaWitt/braket-tickets/commit/8415fce91cb4f2fd10bc6845894468e841d73836))
- **admin:** remove stale min-attribute test after formField migration ([66e9a35](https://github.com/DahliaWitt/braket-tickets/commit/66e9a3557a693729f32938a92a7c8ac75f95bc5e))
- **admin:** remove stale min-attribute test, update codegen ([d2764b5](https://github.com/DahliaWitt/braket-tickets/commit/d2764b50c0035b7be7bb4734fd3e9dfe11560af7))
- **auth:** add concurrent double-click guard tests for login ([d92306f](https://github.com/DahliaWitt/braket-tickets/commit/d92306f3639f7c0a5a1f55ed50124aa0bcdd12d6))
- **convex:** cover broadcast unsubscribe payload ([5e85723](https://github.com/DahliaWitt/braket-tickets/commit/5e85723584fd34ecbb32eba0d4600ee4e7c67eaa))
- **convex:** drain scheduled email work in tests ([3783945](https://github.com/DahliaWitt/braket-tickets/commit/3783945f03d43cfe5c7147651e681c6e3c5c4d01))
- **convex:** prune low-signal backend tests ([2d1153a](https://github.com/DahliaWitt/braket-tickets/commit/2d1153a832fe9fd7c7adeb564bf0a4ba14eb299d))
- **convex:** prune orphaned and consolidate redundant tests ([865e36d](https://github.com/DahliaWitt/braket-tickets/commit/865e36db50375c316ea283c074ee871045d7f69c))
- **e2e:** update auth email expectations ([4979e81](https://github.com/DahliaWitt/braket-tickets/commit/4979e81b3b2192562f627b2e3aa03e7edbbbeb4b))
- **event-management:** assert management data held/remaining/soldOut math ([b3f3749](https://github.com/DahliaWitt/braket-tickets/commit/b3f37496b7e077cb88620b9c67961f8889729df2))
- **frontend:** align checkout sidebar stripe assertions ([8a7d02c](https://github.com/DahliaWitt/braket-tickets/commit/8a7d02c3f0ffc309ff1b8f4b19ddf27843cb952f))
- **frontend:** remove trivial tests and prefer harnesses ([98ee021](https://github.com/DahliaWitt/braket-tickets/commit/98ee0218b71239fe7ba365f41d727d0fbe1b95c8))
- **frontend:** stabilize checkout and selector coverage ([423fb5f](https://github.com/DahliaWitt/braket-tickets/commit/423fb5f88f2650339ff2b27287adf3bef5957b35))
- **stripe:** add test-only organizer Stripe helpers for e2e purchase verification ([5dd77a6](https://github.com/DahliaWitt/braket-tickets/commit/5dd77a680ad0f3bba412419d9d050c8b8ed37a43))
- **stripe:** V2 critical coverage + live sandbox verification ([c21c4a0](https://github.com/DahliaWitt/braket-tickets/commit/c21c4a0eb12cad321f9aae55df3b11a67d6f5d4a))
- **stripe:** V2 payout mutation coverage — intent, submit, confirm, fail, org sync ([173cce8](https://github.com/DahliaWitt/braket-tickets/commit/173cce806de4cfbdbb1df3242ba613d3acbb307d))

### CI/CD

- **codecov:** make patch coverage check informational ([be8f6c9](https://github.com/DahliaWitt/braket-tickets/commit/be8f6c9da992d210df5aac46a4ab86716e4d2734))
