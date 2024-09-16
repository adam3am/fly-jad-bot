const fs = require('fs')
const yaml = require('js-yaml')
const axios = require('axios')

const VALID_DAYS = ['senin', 'selasa', 'rabu']
const MONTHS = [
  'januari',
  'februari',
  'maret',
  'april',
  'mei',
  'juni',
  'juli',
  'agustus',
  'september',
  'oktober',
  'november',
  'desember',
]
const HOLIDAY_API_URL = process.env.HOLIDAY_API_URL

async function fetchHolidays() {
  try {
    const response = await axios.get(HOLIDAY_API_URL)
    return response.data.reduce((acc, holiday) => {
      acc[holiday.date] = holiday.name
      return acc
    }, {})
  } catch (error) {
    console.error('Failed to fetch holidays:', error)
    return {}
  }
}

function isHoliday(date, holidays) {
  return date.toISOString().split('T')[0] in holidays
}

function getNextAvailableDate(startDate, holidays, usedDates) {
  const date = new Date(startDate)
  const sixMonthsFromNow = new Date(date)
  sixMonthsFromNow.setMonth(date.getMonth() + 6)

  while (date <= sixMonthsFromNow) {
    const dateString = date.toISOString().split('T')[0]
    if (
      VALID_DAYS.includes(VALID_DAYS[date.getDay() - 1]) &&
      !isHoliday(date, holidays) &&
      !usedDates.has(dateString)
    ) {
      return dateString
    }
    date.setDate(date.getDate() + 1)
  }

  return startDate
}

function formatDate(dateObj) {
  return `${VALID_DAYS[dateObj.getDay() - 1]} ${dateObj.getDate()} ${MONTHS[dateObj.getMonth()]}`
}

function updateProbeDate(probe, newDate, content) {
  const oldDateRegex = new RegExp(
    `(${probe.id}[\\s\\S]*?appointment_date: ")${probe.requests[0].body.appointment_date}`,
    'g'
  )
  return content.replace(oldDateRegex, `$1${newDate}`)
}

function updateAlertMessage(probe, correctDateText, content) {
  const probeRegex = new RegExp(
    `(${probe.id}[\\s\\S]*?message: \\|\\n\\s+\\*).*?(\\*\\s+{{#if)`,
    'g'
  )
  return content.replace(probeRegex, `$1${correctDateText}$2`)
}

async function updateDates(filePath) {
  let content = fs.readFileSync(filePath, 'utf8')
  const data = yaml.load(content)
  let hasChanges = false
  const usedDates = new Set()
  const currentDate = new Date()
  const sixMonthsFromNow = new Date(currentDate)
  sixMonthsFromNow.setMonth(currentDate.getMonth() + 6)
  const holidays = await fetchHolidays()

  // First pass: collect all currently used dates
  data.probes.forEach((probe) => {
    if (probe.id.startsWith('jadwal-')) {
      let appointmentDate = new Date(probe.requests[0].body.appointment_date)
      usedDates.add(appointmentDate.toISOString().split('T')[0])
    }
  })

  // Second pass: update dates and handle duplicates
  data.probes.forEach((probe) => {
    if (probe.id.startsWith('jadwal-')) {
      let appointmentDate = new Date(probe.requests[0].body.appointment_date)
      let newDate = appointmentDate.toISOString().split('T')[0]

      if (
        appointmentDate > sixMonthsFromNow ||
        usedDates.has(appointmentDate.toISOString().split('T')[0])
      ) {
        newDate = getNextAvailableDate(
          currentDate.toISOString().split('T')[0],
          holidays,
          usedDates
        )
        content = updateProbeDate(probe, newDate, content)
        hasChanges = true
        console.log(
          `Updated ${probe.id} from ${probe.requests[0].body.appointment_date} to ${newDate}`
        )

        usedDates.delete(appointmentDate.toISOString().split('T')[0])
        usedDates.add(newDate)
      }

      if (probe.alerts) {
        const dateObj = new Date(newDate)
        const correctDateText = formatDate(dateObj)
        content = updateAlertMessage(probe, correctDateText, content)
        hasChanges = true
        console.log(
          `Updated alert message for ${probe.id} to "${correctDateText}"`
        )
      }
    }
  })

  if (hasChanges) {
    fs.writeFileSync(filePath, content, 'utf8')
    console.log('Changes made to jadwal.yml')
  } else {
    console.log('No changes needed in jadwal.yml')
  }

  return hasChanges
}

updateDates('jadwal.yml')
  .then((hasChanges) => {
    if (hasChanges) {
      console.log('Dates updated successfully')
      process.exit(0)
    } else {
      console.log('No updates were necessary')
      process.exit(1)
    }
  })
  .catch((error) => {
    console.error('Error updating dates:', error)
    process.exit(1)
  })
