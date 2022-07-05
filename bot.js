const functions = require("firebase-functions");
const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.database().ref();
const { Telegraf, Markup } = require('telegraf');
const fetch = require('node-fetch');
const locales = require('./locales.json');
const bot = new Telegraf(functions.config().telegram.token);
bot.telegram.setWebhook(
    `urlToWebhook`
);
const adminId = functions.config().telegram.adminId; // telegram admin account id goes here

bot.on('inline_query', async ctx => {
    const locale = defineLocale(ctx.from.language_code);
    let user = await db.child(`${ctx.from.id}`).once('value').then(snap => snap.val());
    if (!user) {
        await createUser(
            ctx.from.id, ctx.from.username,
            ctx.from.first_name, ctx.from.last_name
        );
        user = await db.child(`${ctx.from.id}`).once('value').then(snap => snap.val());
    }
    if (user.ban) return;

    const token = user.tkn;
    if (!token) {
        await ctx.answerInlineQuery(null, {
            is_personal: true,
            cache_time: 0,
            switch_pm_text: locales[locale].pmSetToken,
            switch_pm_parameter: 'setToken'
        });
        return;
    }

    const offset = parseInt(ctx.inlineQuery.offset) || 0;
    const filters = user.stngs.fltrs;
    const showExceeded = user.stngs.shExc;
    const showSource = user.stngs.shSrc;

    if (ctx.inlineQuery.query.length > 0) {
        let results = await getDocs(
            ctx.inlineQuery.query, offset, token
        ).catch(async err => {
            await ctx.answerInlineQuery([], {
                is_personal: true,
                switch_pm_text: locales[locale].pmError,
                switch_pm_parameter: 'requestError'
            });
        })
        if (!results) return;

        let result = formResult(filters, showExceeded, showSource, results, locale);
        await ctx.answerInlineQuery(result, {
            is_personal: true,
            next_offset: offset + 50,
            cache_time: 600
        })
    }
});

//user commands
bot.start( async ctx => {
    const locale = defineLocale(ctx.from.language_code);
    switch (ctx.startPayload) {
        case 'setToken':
            const isBanned = await checkBan(ctx.from.id);
            if (isBanned) return;

            await ctx.reply(locales[locale].aboutTokenMsg)
            break;
    
        default:
            let user = await db.child(`${ctx.from.id}`).once('value').then(snap => snap.val());
            if (!user) {
                await createUser(
                    ctx.from.id, ctx.from.username,
                    ctx.from.first_name, ctx.from.last_name
                );
                user = await db.child(`${ctx.from.id}`).once('value').then(snap => snap.val());
            }
            if (user.ban) return;

            await ctx.reply(
                locales[locale].start,
                {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [Markup.button.callback(
                                locales[locale].aboutToken,
                                'aboutToken'
                            ),
                            Markup.button.callback(
                                locales[locale].settingsBtn,
                                'settings'
                            )]
                        ]
                    }
                }
            )
            break;
    }
});

bot.command('settoken', async ctx => {
    const isBanned = await checkBan(ctx.from.id);
    if (isBanned) return;
    
    const locale = defineLocale(ctx.from.language_code);
    const token = ctx.message.text.split(' ')[1];

    if (!token) {
        await ctx.reply(
            locales[locale].usageToken,
            { parse_mode: 'HTML' }
        );
        return;
    }

    try {
        await updateUser(ctx.from.id, ctx.from.username, ctx.from.first_name, ctx.from.last_name, token);
        await ctx.reply(
            locales[locale].tokenSaved,
            Markup.inlineKeyboard([
                Markup.button.switchToChat(
                    locales[locale].switchToChat,
                    'type something here'
                )
            ])
        );
    } catch {
        await ctx.reply(locales[locale].msgErr);
    }
})

bot.on('message', async ctx => {
    const locale = defineLocale(ctx.from.language_code);
    try{
        const detectedText = ctx.message.text ?? ctx.message.caption;
        const checkCommand = detectedText?.split(' ')[0];
        switch (checkCommand) {
            case '/contact': {
                const isBanned = await checkBan(ctx.from.id);
                if (isBanned) return;

                if ( !(ctx.message.text?.split(' ')[1] ?? ctx.message.caption?.split(' ')[1]) ) {
                    await ctx.reply(
                        locales[locale].usageContact,
                        { parse_mode: 'HTML' }
                    );
                    return;
                }

                await ctx.forwardMessage(adminId);
                await ctx.telegram.sendMessage(adminId,
                 `<code>${ctx.chat.id}</code>, ${ctx.chat.username}, ${ctx.chat.first_name}, ${ctx.chat.last_name}, ${ctx.from.language_code}`,
                 { parse_mode: 'HTML' }
                );
                await ctx.reply(locales[locale].msgSendedToAdmin);
                break;
            } //admin commands below
            case '/reply': {
                if (ctx.chat.id == adminId) {
                    const receiver = detectedText.split(' ')[1];
                    const text = detectedText.split(' ').splice(2).join(' ');

                    await checkMsgMediaAndSend(ctx, receiver, text, true, true);
                }
                break;
            }
            case '/ban':{
                if (ctx.chat.id == adminId) {
                    const userToBan = detectedText.split(' ')[1];
                    await updateUser(userToBan, null, null, null, null, true);
                    await ctx.telegram.sendMessage(adminId, 'User banned')
                    .catch(async err => await ctx.telegram.sendMessage(adminId, `${err}`));
                }
                break;
            }
            case '/unban': {
                if (ctx.chat.id == adminId) {
                    const userToUnban = detectedText.split(' ')[1];
                    await updateUser(userToUnban, null, null, null, null, false);
                    await ctx.telegram.sendMessage(adminId, 'User unbanned')
                    .catch(async err => await ctx.telegram.sendMessage(adminId, `${err}`));
                }
                break;
            }
        }
    } catch {
        await ctx.reply(locales[locale].msgErr);
    }
});

bot.action('aboutToken', async ctx => {
    const isBanned = await checkBan(ctx.from.id);
    if (isBanned) return;

    const locale = defineLocale(ctx.from.language_code);
    await ctx.reply(locales[locale].aboutTokenMsg);
    await ctx.answerCbQuery();
});

bot.action('settings', async ctx => {
    const user = await db.child(`${ctx.from.id}`).once('value').then(snap => snap.val());
    if (user.ban) return;

    const locale = defineLocale(ctx.from.language_code);
    await ctx.reply(
        locales[locale].settingsMsg,
        {
            parse_mode: 'HTML',
            reply_markup: sttngsBtns(user.stngs, ctx.from)
        }
    );
    await ctx.answerCbQuery();
});

bot.action('switchSrc', async ctx => {
    const user = await db.child(`${ctx.from.id}`).once('value').then(snap => snap.val());
    if (user.ban) return;

    const locale = defineLocale(ctx.from.language_code);
    try {
        await updateUser(
            ctx.from.id, ctx.from.username, ctx.from.first_name,
            ctx.from.last_name, null, null, null, null, !user.stngs.shSrc
        );

        await ctx.editMessageText(
            locales[locale].settingsMsg,
            {
                parse_mode: 'HTML',
                reply_markup: sttngsBtns(user.stngs, ctx.from)
            }
        );
        await ctx.answerCbQuery(null, {cache_time: 5});
    } catch (err) {
        await ctx.answerCbQuery(locales[locale].msgErr, {show_alert: true});
        functions.logger.error(`[Bot] Encountered an error for ${ctx.updateType}`, err);
    }
});

bot.action('switchExc', async ctx => {
    const user = await db.child(`${ctx.from.id}`).once('value').then(snap => snap.val());
    if (user.ban) return;

    const locale = defineLocale(ctx.from.language_code);
    try {
        await updateUser(
            ctx.from.id, ctx.from.username, ctx.from.first_name,
            ctx.from.last_name, null, null, null, !user.stngs.shExc
        );

        await ctx.editMessageText(
            locales[locale].settingsMsg,
            {
                parse_mode: 'HTML',
                reply_markup: sttngsBtns(user.stngs, ctx.from)
            }
        );
        await ctx.answerCbQuery(null, {cache_time: 5});
    } catch (err) {
        await ctx.answerCbQuery(locales[locale].msgErr, {show_alert: true});
        functions.logger.error(`[Bot] Encountered an error for ${ctx.updateType}`, err);
    }
});

bot.action('switchGif', async ctx => {
    const user = await db.child(`${ctx.from.id}`).once('value').then(snap => snap.val());
    if (user.ban) return;

    const locale = defineLocale(ctx.from.language_code);
    try {
        let settings = user.stngs;
        if (typeof settings.fltrs == "boolean") settings.fltrs = {};
        if (settings.fltrs.gif) {
            delete settings.fltrs.gif;
        } else {
            settings.fltrs.gif = true;
        }
        await updateUser(
            ctx.from.id, ctx.from.username, ctx.from.first_name,
            ctx.from.last_name, null, null, settings.fltrs
        );

        await ctx.editMessageText(
            locales[locale].settingsMsg,
            {
                parse_mode: 'HTML',
                reply_markup: sttngsBtns(settings, ctx.from)
            }
        );
        await ctx.answerCbQuery(null, {cache_time: 5});
    } catch (err) {
        await ctx.answerCbQuery(locales[locale].msgErr, {show_alert: true});
        functions.logger.error(`[Bot] Encountered an error for ${ctx.updateType}`, err);
    }
});

bot.action('switchPic', async ctx => {
    const user = await db.child(`${ctx.from.id}`).once('value').then(snap => snap.val());
    if (user.ban) return;

    const locale = defineLocale(ctx.from.language_code);
    try {
        let settings = user.stngs;
        if (typeof settings.fltrs == "boolean") settings.fltrs = {};
        if (settings.fltrs.pic) {
            delete settings.fltrs.pic;
        } else {
            settings.fltrs.pic = true;
        }
        await updateUser(
            ctx.from.id, ctx.from.username, ctx.from.first_name,
            ctx.from.last_name, null, null, settings.fltrs
        );

        await ctx.editMessageText(
            locales[locale].settingsMsg,
            {
                parse_mode: 'HTML',
                reply_markup: sttngsBtns(settings, ctx.from)
            }
        );
        await ctx.answerCbQuery(null, {cache_time: 5});
    } catch (err) {
        await ctx.answerCbQuery(locales[locale].msgErr, {show_alert: true});
        functions.logger.error(`[Bot] Encountered an error for ${ctx.updateType}`, err);
    }
});

bot.action('switchVid', async ctx => {
    const user = await db.child(`${ctx.from.id}`).once('value').then(snap => snap.val());
    if (user.ban) return;

    const locale = defineLocale(ctx.from.language_code);
    try {
        let settings = user.stngs;
        if (typeof settings.fltrs == "boolean") settings.fltrs = {};
        if (settings.fltrs.vid) {
            delete settings.fltrs.vid;
        } else {
            settings.fltrs.vid = true;
        }
        await updateUser(
            ctx.from.id, ctx.from.username, ctx.from.first_name,
            ctx.from.last_name, null, null, settings.fltrs
        );

        await ctx.editMessageText(
            locales[locale].settingsMsg,
            {
                parse_mode: 'HTML',
                reply_markup: sttngsBtns(settings, ctx.from)
            }
        );
        await ctx.answerCbQuery(null, {cache_time: 5});
    } catch (err) {
        await ctx.answerCbQuery(locales[locale].msgErr, {show_alert: true});
        functions.logger.error(`[Bot] Encountered an error for ${ctx.updateType}`, err);
    }
});

bot.action('switchPdf', async ctx => {
    const user = await db.child(`${ctx.from.id}`).once('value').then(snap => snap.val());
    if (user.ban) return;

    const locale = defineLocale(ctx.from.language_code);
    try {
        let settings = user.stngs;
        if (typeof settings.fltrs == "boolean") settings.fltrs = {};
        if (settings.fltrs.pdf) {
            delete settings.fltrs.pdf;
        } else {
            settings.fltrs.pdf = true;
        }
        await updateUser(
            ctx.from.id, ctx.from.username, ctx.from.first_name,
            ctx.from.last_name, null, null, settings.fltrs
        );

        await ctx.editMessageText(
            locales[locale].settingsMsg,
            {
                parse_mode: 'HTML',
                reply_markup: sttngsBtns(settings, ctx.from)
            }
        );
        await ctx.answerCbQuery(null, {cache_time: 5});
    } catch (err) {
        await ctx.answerCbQuery(locales[locale].msgErr, {show_alert: true});
        functions.logger.error(`[Bot] Encountered an error for ${ctx.updateType}`, err);
    }
});

bot.action('switchZip', async ctx => {
    const user = await db.child(`${ctx.from.id}`).once('value').then(snap => snap.val());
    if (user.ban) return;

    const locale = defineLocale(ctx.from.language_code);
    try {
        let settings = user.stngs;
        if (typeof settings.fltrs == "boolean") settings.fltrs = {};
        if (settings.fltrs.zip) {
            delete settings.fltrs.zip;
        } else {
            settings.fltrs.zip = true;
        }
        await updateUser(
            ctx.from.id, ctx.from.username, ctx.from.first_name,
            ctx.from.last_name, null, null, settings.fltrs
        );

        await ctx.editMessageText(
            locales[locale].settingsMsg,
            {
                parse_mode: 'HTML',
                reply_markup: sttngsBtns(settings, ctx.from)
            }
        );
        await ctx.answerCbQuery(null, {cache_time: 5});
    } catch (err) {
        await ctx.answerCbQuery(locales[locale].msgErr, {show_alert: true});
        functions.logger.error(`[Bot] Encountered an error for ${ctx.updateType}`, err);
    }
});

bot.action('switchAudio', async ctx => {
    const user = await db.child(`${ctx.from.id}`).once('value').then(snap => snap.val());
    if (user.ban) return;

    const locale = defineLocale(ctx.from.language_code);
    try {
        let settings = user.stngs;
        if (typeof settings.fltrs == "boolean") settings.fltrs = {};
        if (settings.fltrs.aud) {
            delete settings.fltrs.aud;
        } else {
            settings.fltrs.aud = true;
        }
        await updateUser(
            ctx.from.id, ctx.from.username, ctx.from.first_name,
            ctx.from.last_name, null, null, settings.fltrs
        );

        await ctx.editMessageText(
            locales[locale].settingsMsg,
            {
                parse_mode: 'HTML',
                reply_markup: sttngsBtns(settings, ctx.from)
            }
        );
        await ctx.answerCbQuery(null, {cache_time: 5});
    } catch (err) {
        await ctx.answerCbQuery(locales[locale].msgErr, {show_alert: true});
        functions.logger.error(`[Bot] Encountered an error for ${ctx.updateType}`, err);
    }
});

//internal functions
function defineLocale(language_code) {
    const locale = (
        language_code == 'ru' || language_code == 'uk' ||
        language_code == 'be' || language_code == 'kk'
    ) ? 'ru' : 'en';
    return locale;
}

async function createUser(uid, uname, fname, lname) {
    const user = {
        [`${uid}`]: {
            uName: uname || null,
            fName: fname || null,
            lName: lname || null,
            tkn: null,
            ban: false,
            stngs: {
                fltrs: {
                    gif: true,
                    pic: true
                },
                shExc: false,
                shSrc: true
            },
            start: Date.now()
        }
    };
    
    await db.update(user);
}

async function updateUser(uid, uname, fname, lname, token, ban, filters, showExceeded, showSource) {
    if (uid) {
        if (uname) {
            await db.child(`${uid}`).update({
                'uName': uname
            });
        }
        if (fname) {
            await db.child(`${uid}`).update({
                'fName': fname
            });
        }
        if (lname) {
            await db.child(`${uid}`).update({
                'lName': lname
            });
        }
        if (token) {
            await db.child(`${uid}`).update({
                'tkn': token
            });
        }
        if (ban || ban == false) {
            await db.child(`${uid}`).update({
                'ban': ban
            });
        }
        if (filters) {
            if (!Object.keys(filters).length) {
                filters = false;
            }
            await db.child(`${uid}/stngs/fltrs`).set(filters);
        }
        if (showExceeded || showExceeded == false) {
            await db.child(`${uid}/stngs`).update({
                'shExc': showExceeded
            });
        }
        if (showSource || showSource == false) {
            await db.child(`${uid}/stngs`).update({
                'shSrc': showSource
            });
        }
    }
}

function sttngsBtns(settings, from) {
    if (typeof settings.fltrs == "boolean") settings.fltrs = {};
    const locale = defineLocale(from.language_code);

    function checkmark(prop) {
        switch (prop) {
            case 'gif':
                if (settings.fltrs.gif) return '✅';
                return '❌';

            case 'pic':
                if (settings.fltrs.pic) return '✅';
                return '❌';

            case 'vid':
                if (settings.fltrs.vid) return '✅';
                return '❌';

            case 'pdf':
                if (settings.fltrs.pdf) return '✅';
                return '❌';
    
            case 'zip':
                if (settings.fltrs.zip) return '✅';
                return '❌';

            case 'aud':
                if (settings.fltrs.aud) return '✅';
                return '❌';
        
            case 'exc':
                if (settings.shExc) return '✅';
                return '❌';

            case 'src':
                if (settings.shSrc) return '✅';
                return '❌';
        }
    }

    return {
        inline_keyboard: [
        [Markup.button.callback(
            `${checkmark('src')} ${locales[locale].sttngsSrcBtn}`,
            'switchSrc'
        )],
        [Markup.button.callback(
            `${checkmark('exc')} ${locales[locale].sttngsExcBtn}`,
            'switchExc'
        )],
        [Markup.button.callback(
            `${checkmark('gif')} ${locales[locale].sttngsGifBtn}`,
            'switchGif'
        ),
        Markup.button.callback(
            `${checkmark('pic')} ${locales[locale].sttngsPicBtn}`,
            'switchPic'
        ),
        Markup.button.callback(
            `${checkmark('vid')} ${locales[locale].sttngsVidBtn}`,
            'switchVid'
        )],
        [Markup.button.callback(
            `${checkmark('pdf')} ${locales[locale].sttngsPdfBtn}`,
            'switchPdf'
        ),
        Markup.button.callback(
            `${checkmark('zip')} ${locales[locale].sttngsZipBtn}`,
            'switchZip'
        ),
        Markup.button.callback(
            `${checkmark('aud')} ${locales[locale].sttngsAudioBtn}`,
            'switchAudio'
        )]
    ]};
}

async function getDocs(query, offset, token) {
    const encodedQuery = encodeURIComponent(query);
    const encodedToken = encodeURIComponent(token);
    let response = await fetch(`https://api.vk.com/method/docs.search?return_tags=0&search_own=0&count=50&offset=${offset}&access_token=${encodedToken}&v=5.131&q=${encodedQuery}`);
    let json = await response.json();
    return json.response.items;
}

function formResult(filters, showExceeded, showSource, results, locale) {
    const result = results.filter(elem => {
        let  exceedDocument, exceedVideo, exceedPhoto, exceedGif;
        if (!showExceeded) {
            exceedDocument = elem.size > 20000000;
            exceedVideo = elem.size > 20000000;
            exceedPhoto = elem.size > 12000000;
            exceedGif = elem.size > 8000000;
        }

        if ( (elem.type !== 1 || elem.ext !== 'pdf' || !filters.pdf || (exceedDocument ?? false) ) &&
         (elem.type !== 2 || elem.ext !== 'zip' || !filters.zip || (exceedDocument ?? false) ) &&
         (elem.type !== 3 || !filters.gif || (exceedGif ?? false) ) &&
         (elem.type !== 4 || elem.ext === 'svg' || !filters.pic || (exceedPhoto ?? false) ) &&
         (elem.type !== 5 || elem.ext !== 'mp3' || !filters.aud || (exceedDocument ?? false)) &&
         (elem.type !== 6 || elem.ext !== 'mp4' || !filters.vid || (exceedVideo ?? false) ) ) {
            return false;
        };
        return true;
    }).map((elem, index) => {
        if (elem.type == 1) {
            return {
                type: 'document',
                id: index,
                title: elem.title,
                document_url: elem.url,
                mime_type: "application/pdf",
                caption:  showSource ? `<b><a href="${elem.url}">${locales[locale].downloadResult}</a></b>`: null,
                parse_mode: 'HTML'
            };
        } else if (elem.type == 2) {
            return {
                type: 'document',
                id: index,
                title: elem.title,
                document_url: elem.url,
                mime_type: "application/zip",
                caption: showSource ? `<b><a href="${elem.url}">${locales[locale].downloadResult}</a></b>`: null,
                parse_mode: 'HTML'
            };
        } else if (elem.type == 3) {
            const minPreview = elem.preview?.photo?.sizes.find(
                elem => elem.type == 'x'
            );
            return {
                type: 'gif',
                id: index,
                gif_url: elem.url,
                thumb_url: minPreview?.src ?? elem.url,
                gif_width: minPreview?.width,
                gif_height: minPreview?.height,
                caption: showSource ? `<b><a href="${elem.url}">${locales[locale].downloadResult}</a></b>`: null,
                parse_mode: 'HTML'
            };
        } else if (elem.type == 4) {
            const minPreview = elem.preview?.photo?.sizes.find(
                elem => elem.type == 'x'
            );
            return {
                type: 'photo',
                id: index,
                photo_url: elem.url,
                thumb_url: minPreview?.src ?? elem.url,
                photo_width: minPreview?.width,
                photo_height: minPreview?.height,
                caption: showSource ? `<b><a href="${elem.url}">${locales[locale].downloadResult}</a></b>`: null,
                parse_mode: 'HTML'
            };
        } else if (elem.type == 5) {
                return {
                type: 'audio',
                id: index,
                title: elem.title,
                audio_url: elem.url,
                caption: showSource ? `<b><a href="${elem.url}">${locales[locale].downloadResult}</a></b>`: null,
                parse_mode: 'HTML'
            };
        } else if (elem.type == 6) {
            return {
            type: 'video',
            id: index,
            title: elem.title,
            video_url: elem.url,
            thumb_url: 'https://vk.com/favicon.ico',
            mime_type: "video/mp4",
            caption:  showSource ? `<b><a href="${elem.url}">${locales[locale].downloadResult}</a></b>`: null,
            parse_mode: 'HTML'
            }
        };
    });
    return result;
}

async function checkMsgMediaAndSend(ctx, receiver, text, feedback, sendErr) {
    if (ctx.message.photo) {
        await ctx.telegram.sendPhoto(receiver, ctx.message.photo[0].file_id, {
            caption: text
            }
        )
        .then(async () => {
            if (feedback) await ctx.telegram.sendMessage(adminId, 'Message sended')
        })
        .catch(async err => {
            if (sendErr) await ctx.telegram.sendMessage(adminId, `${err}`)
        });
        return;
    } else if (ctx.message.animation) {
        await ctx.telegram.sendAnimation(receiver, ctx.message.animation.file_id, {
            caption: text
            }
        )
        .then(async () => {
            if (feedback) await ctx.telegram.sendMessage(adminId, 'Message sended')
        })
        .catch(async err => {
            if (sendErr) await ctx.telegram.sendMessage(adminId, `${err}`)
        });
        return;
    } else if (ctx.message.video) {
        await ctx.telegram.sendVideo(receiver, ctx.message.video.file_id, {
            caption: text
            }
        )
        .then(async () => {
            if (feedback) await ctx.telegram.sendMessage(adminId, 'Message sended')
        })
        .catch(async err => {
            if (sendErr) await ctx.telegram.sendMessage(adminId, `${err}`)
        });
        return;
    } else if (ctx.message.document) {
        await ctx.telegram.sendDocument(receiver, ctx.message.document.file_id, {
            caption: text
            }
        )
        .then(async () => {
            if (feedback) await ctx.telegram.sendMessage(adminId, 'Message sended')
        })
        .catch(async err => {
            if (sendErr) await ctx.telegram.sendMessage(adminId, `${err}`)
        });
        return;
    } else if (ctx.message.audio) {
        await ctx.telegram.sendAudio(receiver, ctx.message.audio.file_id, {
            caption: text
            }
        )
        .then(async () => {
            if (feedback) await ctx.telegram.sendMessage(adminId, 'Message sended')
        })
        .catch(async err => {
            if (sendErr) await ctx.telegram.sendMessage(adminId, `${err}`)
        });
        return;
    } else {
        await ctx.telegram.sendMessage(receiver, text)
        .then(async () => {
            if (feedback) await ctx.telegram.sendMessage(adminId, 'Message sended')
        })
        .catch(async err => {
            if (sendErr) await ctx.telegram.sendMessage(adminId, `${err}`)
        });
    }
}

async function checkBan(uid) {
    const ban = await db.child(`${uid}`).once('value').then(snap => snap.val().ban);
    return ban;
}

bot.catch((err, ctx) => {
	functions.logger.error(`[Bot] Encountered an error for ${ctx.updateType}`, err);
});

exports.botHook = functions.region('functionRegion').runWith(
    {
        minInstances: 1,
        maxInstances: 4,
        memory: '128MB',
        timeoutSeconds: 5
    }
).https.onRequest(async (req, res) => {
    try {
        await bot.handleUpdate(req.body);
      } finally {
        res.status(200).end();
    }
});