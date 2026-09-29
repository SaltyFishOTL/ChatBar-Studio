package com.example.chatbar.ui.imageprompt

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.example.chatbar.domain.image.ImportedProcessImage
import com.example.chatbar.domain.image.NovelAiAccountUsage
import com.example.chatbar.domain.image.NovelAiEnhanceOptions
import com.example.chatbar.domain.image.NovelAiGenerationChargeKind
import com.example.chatbar.domain.image.NovelAiPostProcessPolicy
import com.example.chatbar.domain.image.NovelAiPostProcessState
import com.example.chatbar.domain.image.NovelAiPostProcessTab
import com.example.chatbar.domain.image.ProcessImageKind
import com.example.chatbar.ui.components.ImageComparison
import com.example.chatbar.ui.components.ImageComparisonState
import com.example.chatbar.ui.components.saveImageToGallery
import com.example.chatbar.ui.components.shareImage
import com.example.chatbar.ui.kit.*
import kotlin.math.roundToInt

@Composable
internal fun NovelAiPostProcessScreen(
    source: ImportedProcessImage,
    state: NovelAiPostProcessState,
    account: NovelAiAccountUsage?,
    onTab: (NovelAiPostProcessTab) -> Unit,
    onOptions: (NovelAiEnhanceOptions) -> Unit,
    onStart: () -> Unit,
    onCancel: () -> Unit,
    onUse: () -> Unit,
    onDismiss: () -> Unit
) {
    val context = LocalContext.current
    var fullscreen by remember { mutableStateOf(false) }
    var advanced by remember { mutableStateOf(false) }
    val result = state.result
    val comparison = remember(source.path, state.tab, result?.image?.path) { ImageComparisonState() }
    val enhance = state.tab == NovelAiPostProcessTab.ENHANCE
    val scales = state.enhanceSource?.let {
        NovelAiPostProcessPolicy.scales(source.width, source.height, it.settings.model)
    }.orEmpty()
    val unavailable = when {
        source.kind != ProcessImageKind.STATIC -> "GIF/APNG 不支持直接处理；伪装图片请先还原"
        enhance -> state.enhanceUnavailable
            ?: if (state.enhanceSource == null || state.options.scale !in scales) "当前图片没有可用的 Enhance 参数" else null
        NovelAiPostProcessPolicy.upscaleCost(source.width, source.height) == null -> "输入最多 3,145,728 像素，不会自动缩图"
        else -> null
    }
    val costLabel = if (unavailable != null) "不可用" else if (!enhance) {
        "${NovelAiPostProcessPolicy.upscaleCost(source.width, source.height)} Anlas"
    } else {
        val cost = NovelAiPostProcessPolicy.enhanceCost(requireNotNull(state.enhanceSource), source.width, source.height, state.options, account)
        when (cost.kind) {
            NovelAiGenerationChargeKind.FREE -> "预计免费"
            NovelAiGenerationChargeKind.V5_ALLOWANCE -> "预计使用 V5 配额"
            NovelAiGenerationChargeKind.ANLAS -> "预计 ${cost.anlas} Anlas"
        }
    }
    val close = { if (state.busy) onCancel(); onDismiss() }
    Dialog(onDismissRequest = { if (fullscreen) fullscreen = false else close() }, properties = DialogProperties(
        usePlatformDefaultWidth = false, decorFitsSystemWindows = false, dismissOnClickOutside = false
    )) {
        BackHandler { if (fullscreen) fullscreen = false else close() }
        Column(Modifier.fillMaxSize().background(ChatBarTheme.colors.background).navigationBarsPadding()) {
            CbTopBar(
                title = if (fullscreen) "图片对比" else "增强 / 放大",
                navigation = { CbButton("返回", { if (fullscreen) fullscreen = false else close() }, variant = ButtonVariant.Ghost, size = ButtonSize.Sm) }
            )
            if (!fullscreen) CbTabs(
                items = NovelAiPostProcessTab.entries.map { it.label }, selectedIndex = state.tab.ordinal,
                onSelected = { onTab(NovelAiPostProcessTab.entries[it]) }, swipeEnabled = false, enabled = !state.busy
            )
            Row(Modifier.fillMaxWidth().padding(horizontal = ChatBarSpacing.md), horizontalArrangement = Arrangement.SpaceBetween) {
                CbText("原图 ${source.width}×${source.height}", style = ChatBarTheme.typography.caption)
                CbText(result?.image?.let { "${if (enhance) "增强" else "放大"} ${it.width}×${it.height}" } ?: "等待处理结果", style = ChatBarTheme.typography.caption)
            }
            ImageComparison(source, result?.image, comparison, Modifier.fillMaxWidth().weight(if (fullscreen) 1f else 1.3f))
            Row(Modifier.fillMaxWidth().padding(horizontal = ChatBarSpacing.sm), horizontalArrangement = Arrangement.SpaceBetween) {
                CbButton("重置对比", comparison::reset, variant = ButtonVariant.Ghost, size = ButtonSize.Sm)
                CbButton(if (fullscreen) "收起大图" else "全屏对比", { fullscreen = !fullscreen }, variant = ButtonVariant.Ghost, size = ButtonSize.Sm)
            }
            if (!fullscreen) {
                Column(
                    Modifier.fillMaxWidth().weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = ChatBarSpacing.md),
                    verticalArrangement = Arrangement.spacedBy(ChatBarSpacing.sm)
                ) {
                    unavailable?.let {
                        CbText(it, color = ChatBarTheme.colors.mutedForeground)
                        if (enhance) CbButton("切换到 Upscale", { onTab(NovelAiPostProcessTab.UPSCALE) }, enabled = !state.busy, variant = ButtonVariant.Outline)
                    }
                    CbText(if (result == null) "处理完成后可拖动竖线对比，双指缩放查看细节。" else "拖动竖线对比 · 双指缩放查看细节",
                        style = ChatBarTheme.typography.caption, color = ChatBarTheme.colors.mutedForeground)
                    if (enhance && unavailable == null) {
                        val recipe = requireNotNull(state.enhanceSource)
                        CbText("${recipe.settings.model.displayName} · Steps ${recipe.settings.steps} · Guidance ${recipe.settings.guidance}", style = ChatBarTheme.typography.caption)
                        CbText("${recipe.settings.sampler.displayName} · CFG Rescale ${recipe.settings.cfgRescale} · 使用图片元数据", style = ChatBarTheme.typography.caption)
                        CbSelect(
                            value = state.options.scale, options = scales, optionLabel = { scale ->
                                val size = NovelAiPostProcessPolicy.outputSize(source.width, source.height, scale)
                                "${scale.label} · 预计 ${size.width}×${size.height}"
                            }, onValueChange = { onOptions(state.options.copy(scale = it)) }, enabled = !state.busy,
                            placeholder = "增强倍率"
                        )
                        CbText("增强等级：${state.options.magnitude?.toString() ?: "自定义"}")
                        Row(horizontalArrangement = Arrangement.spacedBy(ChatBarSpacing.xs)) {
                            (1..5).forEach { level ->
                                CbChoiceChip(level.toString(), state.options.magnitude == level, { onOptions(state.options.withMagnitude(level)) },
                                    Modifier.weight(1f).heightIn(min = 48.dp), enabled = !state.busy)
                            }
                        }
                        CbButton(if (advanced) "收起高级参数" else "高级参数", { advanced = !advanced }, variant = ButtonVariant.Ghost, size = ButtonSize.Sm)
                        if (advanced) {
                            CbText("Strength：${"%.2f".format(state.options.strength)}")
                            CbSlider(state.options.strength, { onOptions(state.options.copy(strength = (it * 100).roundToInt() / 100f)) },
                                0.01f..0.99f, steps = 97, enabled = !state.busy, contentDescription = "增强强度")
                            CbText("Noise：${"%.2f".format(state.options.noise)}")
                            CbSlider(state.options.noise, { onOptions(state.options.copy(noise = (it * 100).roundToInt() / 100f)) },
                                0f..0.99f, steps = 98, enabled = !state.busy, contentDescription = "增强噪声")
                        }
                    } else if (!enhance) {
                        CbText("固定 2× · ${source.width}×${source.height} → ${source.width * 2}×${source.height * 2}")
                        CbText("按输入像素计费，消耗 1–4 Anlas。", style = ChatBarTheme.typography.caption, color = ChatBarTheme.colors.mutedForeground)
                    }
                    if (account != null) CbText("账户余额 ${account.anlas} Anlas", style = ChatBarTheme.typography.caption)
                    else CbText("账户信息暂不可用，费用以服务端结算为准", style = ChatBarTheme.typography.caption)
                    if (state.parametersChanged) CbText("参数已修改，需重新处理；当前显示上次成功结果。", color = ChatBarTheme.colors.primary)
                    state.status?.let { CbText(it) }
                    state.error?.let { CbText(it, color = ChatBarTheme.colors.destructive) }
                }
                Column(Modifier.fillMaxWidth().padding(ChatBarSpacing.sm)) {
                    if (state.busy) CbButton(if (state.cancelling) "正在取消…" else "取消处理", onCancel,
                        Modifier.fillMaxWidth(), enabled = !state.cancelling, variant = ButtonVariant.Destructive)
                    else CbButton("${if (enhance) "开始增强" else "开始放大"} · $costLabel", onStart,
                        Modifier.fillMaxWidth(), enabled = unavailable == null)
                    if (result != null) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(ChatBarSpacing.xs)) {
                        CbButton("保存", { saveImageToGallery(context, result.image.path) }, Modifier.weight(1f), enabled = !state.busy, variant = ButtonVariant.Outline, size = ButtonSize.Sm)
                        CbButton("分享", { shareImage(context, result.image.path) }, Modifier.weight(1f), enabled = !state.busy, variant = ButtonVariant.Outline, size = ButtonSize.Sm)
                        CbButton("用作当前图片", onUse, Modifier.weight(1.5f), enabled = !state.busy, variant = ButtonVariant.Outline, size = ButtonSize.Sm, autoSizeText = true)
                    }
                }
            }
        }
    }
}
