const moment = require('moment')
const momentDurationFormatSetup = require('moment-duration-format')
const ytdl = require('ytdl-core')
const _ = require('lodash')

momentDurationFormatSetup(moment)

class VoiceHandler {
  constructor (voiceState, bot) {
    const modules = bot.modules

    this.cl = modules.consoleLogger
    this.yh = modules.youtubeHandler
    this.ms = modules.messageSender
    this.state = voiceState
  }


  async addTrack (id, requester) {
    const data = await ytdl.getInfo(id)

    const track = {
      id: data.video_id,
      title: data.title,
      description: (data.description.length > 180)
        ? data.description.slice(0, 180) + '...'
        : data.description,
      uploader: data.author.name,
      requester: requester.toString(),
      thumbnail: data.player_response.videoDetails.thumbnail.thumbnails[0].url,
      duration: moment.duration(data.length_seconds)
    }

    this.state.queue.push(track)
    if (!this.state.nowPlaying) {
      await this.playNextTrack()
    }
  }

  async addPlaylist (id, requester) {
    const playlist = await this.yh.getPlaylist(id)
    playlist.forEach(e => { this.addTrack(e, requester) })
  }

  async playNextTrack () {
    const track = this.state.queue.shift()
    const stream = ytdl(track.id)

    this.state.dispatchers = await this.state.voiceConnection.play(stream, {
      bitrate: '2M',
    })
    const { audio } = this.state.dispatchers

    this.resetVoteHandlers()

    audio.setVolume(this.state.volume)

    this.ms.youtubeTrackInfo(track, this.state.msgChannel)
    this.cl.info(`Playing track: [${track.title}] in voice channel [${this.state.voiceConnection.channel.name}]`)
    this.state.nowPlaying = track

    audio.once('end', () => {
      this.state.prevTrack = this.state.nowPlaying

      if (this.state.queue.length === 0) {
        this.ms.info('Queue has been emptied. Leaving voice channel...', this.state.msgChannel)
        this.state.nowPlaying = undefined
        this.leaveVoice()
      } else if (this.state.voiceConnection.channel.members.array().length === 1) {
        this.ms.info('Empty voice channel detected. Leaving voice channel...', this.state.msgChannel)
        this.state.nowPlaying = undefined
        this.leaveVoice()
      } else this.playNextTrack()
    })
  }

  async joinVoice (vChannel) {
    try {
      this.state.voiceConnection = await vChannel.join({ video: true, stealthVideo: true })
      this.cl.info(`Joined voice channel: [${vChannel.id}] on guild [${vChannel.guild.name}]`)
    } catch (err) { throw new Error(err) }
  }

  async leaveVoice () {
    if (!this.state.voiceConnection) reject(new Error('NOT_IN_VOICE'))

    const { audio, video } = this.state.dispatchers

    audio.removeAllListeners('end')
    await this.state.voiceConnection.disconnect()

    this.state.voiceConnection = undefined
    this.state.dispatchers = undefined
    this.state.nowPlaying = undefined
    this.state.queue = []

    this.resetVoteHandlers()
  }

  async setVolume (volume) {
    const convertedVolume = volume * 0.006

    const { audio } = this.state.dispatchers

    this.state.volume = convertedVolume
    if (audio) audio.setVolumeLogarithmic(convertedVolume)

    return volume
  }

  skipTrack () {
    this.state.voiceDispatcher.end()
  }

  resetVoteHandlers () {
    for (const handler of _.values(this.state.voteHandlers)) handler.reset()
  }
}

module.exports = VoiceHandler
