import { promises as fs } from 'fs'
import path from 'path'
import Env from '@ioc:Adonis/Core/Env'
import Application from '@ioc:Adonis/Core/Application'
import { v4 as uuidv4 } from 'uuid'
import { MessageMedia, Client } from 'whatsapp-web.js'

export type ScheduleType = 'message' | 'setStatus' | 'evokeStatus'

export interface Schedule {
  id: string
  clientId: string
  type: ScheduleType

  // Contents
  chatIds?: string[]
  message?: string
  mediaPath?: string 
  filename?: string
  statusText?: string
  revokeMessageId?: string

  // Timing
  isRecurring: boolean
  timestamp?: number 
  
  recurrence?: {
    type: 'daily' | 'weekly' | 'monthly'
    time: string 
    daysOfWeek?: number[] 
    dayOfMonth?: number 
  }

  lastRunAt?: number
  createdAt: number
}

export default class ScheduleService {
  private file: string
  private schedules: Schedule[] = []
  private timer: NodeJS.Timeout | null = null
  
  constructor() {
    // Isolated storage within the external data path
    this.file = path.join(Env.get('WA_SESSION_DIR'), 'schedules.json')
  }

  public async init() {
    try {
      const data = await fs.readFile(this.file, 'utf8')
      this.schedules = JSON.parse(data)
    } catch (e) {
      this.schedules = []
    }
    this.startTimer()
  }

  private startTimer() {
    const now = new Date()
    // Align interval precisely to the start of the next minute
    const msUntilNextMinute = 60000 - (now.getSeconds() * 1000 + now.getMilliseconds())
    
    setTimeout(() => {
      this.tick()
      this.timer = setInterval(() => this.tick(), 60000)
    }, msUntilNextMinute)
  }

  public async shutdown() {
    if (this.timer) clearInterval(this.timer)
  }

  private async tick() {
    const now = new Date()
    const nowMs = now.getTime()
    const currentH = now.getHours()
    const currentM = now.getMinutes()
    const currentDOW = now.getDay()
    const currentDOM = now.getDate()
    const timeStr = `${currentH.toString().padStart(2, '0')}:${currentM.toString().padStart(2, '0')}`

    let updated = false

    for (const s of this.schedules) {
      let shouldRun = false

      if (!s.isRecurring && s.timestamp) {
        if (s.timestamp <= nowMs && (!s.lastRunAt || s.lastRunAt < s.timestamp)) {
          shouldRun = true
        }
      } else if (s.isRecurring && s.recurrence) {
        if (s.recurrence.time === timeStr) {
          if (s.recurrence.type === 'daily') shouldRun = true
          if (s.recurrence.type === 'weekly' && s.recurrence.daysOfWeek?.includes(currentDOW)) shouldRun = true
          if (s.recurrence.type === 'monthly' && s.recurrence.dayOfMonth === currentDOM) shouldRun = true
        }
      }

      if (shouldRun) {
        // Prevent aggressive overlapping execution within the same execution minute 
        if (s.lastRunAt && nowMs - s.lastRunAt < 50000) continue
        
        s.lastRunAt = nowMs
        updated = true
        this.executeSchedule(s).catch(err => console.error(`[Scheduler] Event ${s.id} failed:`, err))
      }
    }

    if (updated) await this.save()
  }

  private async executeSchedule(s: Schedule) {
    const botService = Application.container.use('App/Services/BotService') as any
    const client = botService.clients.get(s.clientId) as Client
    
    if (!client || botService.statuses.get(s.clientId) !== 'ready') return

    if (s.type === 'message' && s.chatIds && s.chatIds.length > 0) {
      let msgContent: any = s.message || ''
      const args: any = {}
      
      if (s.mediaPath) {
        try {
          if (s.mediaPath.startsWith('http')) {
            msgContent = await MessageMedia.fromUrl(s.mediaPath)
          } else {
            msgContent = MessageMedia.fromFilePath(s.mediaPath)
          }
          if (s.filename) msgContent.filename = s.filename
          if (s.message) args.caption = s.message
        } catch (e) {
          console.error(`[Scheduler] Media load failed for schedule ${s.id}:`, e)
        }
      }

      for (const chatId of s.chatIds) {
        try {
          await client.sendMessage(chatId, msgContent, args)
        } catch (e) {
          console.error(`[Scheduler] Failed to send scheduled msg to ${chatId}:`, e)
        }
      }
    } else if (s.type === 'setStatus' && s.statusText) {
      await client.setStatus(s.statusText)
    } else if (s.type === 'evokeStatus' && s.revokeMessageId) {
      if (typeof (client as any).evokeStatusMessage === 'function') {
        await (client as any).evokeStatusMessage(s.revokeMessageId)
      } else if (typeof (client as any).revokeStatus === 'function') {
        await (client as any).revokeStatus(s.revokeMessageId)
      }
    }
  }

  private async save() {
    await fs.writeFile(this.file, JSON.stringify(this.schedules, null, 2), 'utf8')
  }

  public getSchedulesForClient(clientId: string) {
    return this.schedules.filter(s => s.clientId === clientId)
  }

  public async createSchedule(clientId: string, data: Partial<Schedule>) {
    const s: Schedule = {
      ...data,
      id: uuidv4(),
      clientId,
      createdAt: Date.now()
    } as Schedule
    this.schedules.push(s)
    await this.save()
    return s
  }

  public async updateSchedule(clientId: string, id: string, data: Partial<Schedule>) {
    const idx = this.schedules.findIndex(s => s.id === id && s.clientId === clientId)
    if (idx !== -1) {
      this.schedules[idx] = { ...this.schedules[idx], ...data }
      await this.save()
      return this.schedules[idx]
    }
    throw new Error('Schedule not found')
  }

  public async deleteSchedule(clientId: string, id: string) {
    this.schedules = this.schedules.filter(s => !(s.id === id && s.clientId === clientId))
    await this.save()
  }

  public async bulkCreate(clientId: string, items: Partial<Schedule>[]) {
    const added: Schedule[] = []
    for (const item of items) {
      const s: Schedule = {
        ...item,
        id: uuidv4(),
        clientId,
        createdAt: Date.now()
      } as Schedule
      added.push(s)
      this.schedules.push(s)
    }
    await this.save()
    return added
  }
}